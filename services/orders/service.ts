import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { OrderDraft, ProductTruth, emptyOrderDraft, updateOrderDraft, validateOrderDraft } from "@/services/orders/engine";
import { isDevPreview } from "@/lib/env";
import { getPreviewOrders } from "@/services/preview/store";

const json = (value: unknown) => value as Prisma.InputJsonValue;

export async function getOrCreateOrderSession(input: { pageId: string; customerId: string }) {
  const existing = await prisma.orderSession.findFirst({ where: { pageId: input.pageId, customerId: input.customerId, status: "ACTIVE" }, orderBy: { updatedAt: "desc" } });
  if (existing) return existing;
  const draft = emptyOrderDraft(`${input.pageId}:${input.customerId}:${Date.now()}`);
  return prisma.orderSession.create({ data: { pageId: input.pageId, customerId: input.customerId, state: json(draft), status: "ACTIVE" } });
}

export async function updateDraft(input: { pageId: string; customerId: string; patch: Partial<OrderDraft>; countryCode?: string }) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.pageId}:${input.customerId}`}, 0))`;
    const session = await tx.orderSession.findFirst({ where: { pageId: input.pageId, customerId: input.customerId, status: "ACTIVE" }, orderBy: { updatedAt: "desc" } });
    const current = session ? session.state : emptyOrderDraft(`${input.pageId}:${input.customerId}:${Date.now()}`);
    const draft = updateOrderDraft(current, input.patch, { countryCode: input.countryCode });
    if (!session) return tx.orderSession.create({ data: { pageId: input.pageId, customerId: input.customerId, state: json(draft), status: "ACTIVE" } });
    return tx.orderSession.update({ where: { id: session.id }, data: { state: json(draft) } });
  });
}

export async function confirmDraft(input: { pageId: string; customerId: string; product: ProductTruth; requiredFields: string[]; currency: string; configurationVersion?: number; countryCode?: string }) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.pageId}:${input.customerId}`}, 0))`;
    const session = await tx.orderSession.findFirst({ where: { pageId: input.pageId, customerId: input.customerId, status: "ACTIVE" }, orderBy: { updatedAt: "desc" } });
    if (!session) {
      // A replayed confirmation after the transaction committed must return
      // the existing order instead of creating a second order/outbox event.
      const completed = await tx.orderSession.findFirst({ where: { pageId: input.pageId, customerId: input.customerId, status: "COMPLETED", orderId: { not: null } }, orderBy: { updatedAt: "desc" } });
      if (completed?.orderId) {
        const existing = await tx.order.findFirst({ where: { id: completed.orderId, pageId: input.pageId, customerId: input.customerId } });
        if (existing) return existing;
      }
      throw new Error("No active order draft");
    }
    const draft = session.state as unknown as OrderDraft;
    const validation = validateOrderDraft(draft, input.requiredFields, input.product, input.configurationVersion, input.countryCode ?? "BD");
    if (!validation.valid) {
      if (validation.priceChanged) {
        const refreshed = { ...draft, priceAtDraft: input.product.variant.price, unitPrice: input.product.variant.price, state: "ORDER_DRAFT" as const };
        await tx.orderSession.update({ where: { id: session.id }, data: { state: json(refreshed) } });
        throw new Error("Product price changed; the updated price must be confirmed again");
      }
      throw new Error(`Order is incomplete: ${validation.missing.join(", ")}`);
    }
    const page = await tx.page.findUnique({ where: { id: input.pageId }, select: { name: true } });
    const snapshot = {
      page_id: input.pageId,
      page_name: page?.name ?? "",
      customer_id: input.customerId,
      product_id: input.product.id,
      product_display_name: input.product.name,
      variant_id: input.product.variant.id,
      variant_details: { sku: input.product.variant.sku, size: input.product.variant.size ?? null, color: input.product.variant.color ?? null },
      unit_price: input.product.variant.price,
      quantity: draft.quantity,
      currency: input.currency,
      customer_name: draft.customerName,
      normalized_phone: draft.phone,
      phone_original: draft.phoneOriginal,
      full_address: draft.fullAddress,
      configuration_version: input.configurationVersion ?? draft.configurationVersion,
      confirmed_at: new Date().toISOString(),
    };
    const order = await tx.order.create({ data: { pageId: input.pageId, customerId: input.customerId, orderSessionId: session.id, status: "CONFIRMED", total: input.product.variant.price * (draft.quantity ?? 1), payload: json(snapshot), productId: input.product.id, productName: input.product.name, variantId: input.product.variant.id, variantDetails: json(snapshot.variant_details), unitPrice: input.product.variant.price, quantity: draft.quantity, currency: input.currency, customerName: draft.customerName, normalizedPhone: draft.phone, phoneOriginal: draft.phoneOriginal, fullAddress: draft.fullAddress, configurationVersion: input.configurationVersion ?? draft.configurationVersion, confirmedAt: new Date() } });
    await tx.orderRevision.create({ data: { orderId: order.id, revision: 0, eventType: "NEW_ORDER", payload: json(snapshot), changedFields: json([]) } });
    await tx.orderSession.update({ where: { id: session.id }, data: { status: "COMPLETED", orderId: order.id, state: json({ ...draft, state: "CONFIRMED" }) } });
    const telegram = await tx.pageTelegramSettings.findUnique({ where: { pageId: input.pageId }, select: { newOrderEnabled: true } });
    if (telegram?.newOrderEnabled) {
      const outbox = await tx.deliveryOutbox.create({ data: { pageId: input.pageId, deliveryKey: `${order.id}:0:NEW_ORDER`, eventType: "NEW_ORDER", revision: 0, payload: json(snapshot) } });
      await tx.job.create({ data: { pageId: input.pageId, type: "PROCESS_TELEGRAM_DELIVERY", payload: json({ deliveryOutboxId: outbox.id }), idempotencyKey: `telegram:${order.id}:0:NEW_ORDER` } });
    }
    return order;
  });
}

export async function reviseConfirmedOrder(input: { pageId: string; orderId: string; changes: Record<string, unknown> }) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findFirst({ where: { id: input.orderId, pageId: input.pageId } });
    if (!order) throw new Error("Order not found in page scope");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.orderId}, 0))`;
    if (!['CONFIRMED', 'UPDATED'].includes(order.status)) throw new Error("Only confirmed orders can be updated");
    const revision = await tx.orderRevision.count({ where: { orderId: order.id } });
    const payload = { ...(order.payload as Record<string, unknown>), ...input.changes };
    const updated = await tx.order.update({ where: { id: order.id }, data: { status: "UPDATED", payload: json(payload), customerName: typeof payload.customer_name === "string" ? payload.customer_name : order.customerName, normalizedPhone: typeof payload.normalized_phone === "string" ? payload.normalized_phone : order.normalizedPhone, fullAddress: typeof payload.full_address === "string" ? payload.full_address : order.fullAddress } });
    await tx.orderRevision.create({ data: { orderId: order.id, revision, eventType: "UPDATED", payload: json(payload), changedFields: json(Object.keys(input.changes)) } });
    const telegram = await tx.pageTelegramSettings.findUnique({ where: { pageId: input.pageId }, select: { updatedOrderEnabled: true } });
    if (telegram?.updatedOrderEnabled) {
      const outbox = await tx.deliveryOutbox.create({ data: { pageId: input.pageId, deliveryKey: `${order.id}:${revision}:UPDATED`, eventType: "UPDATED_ORDER", revision, payload: json(payload) } });
      await tx.job.create({ data: { pageId: input.pageId, type: "PROCESS_TELEGRAM_DELIVERY", payload: json({ deliveryOutboxId: outbox.id }), idempotencyKey: `telegram:${order.id}:${revision}:UPDATED` } });
    }
    return updated;
  });
}

export async function cancelConfirmedOrder(input: { pageId: string; orderId: string }) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findFirst({ where: { id: input.orderId, pageId: input.pageId } });
    if (!order) throw new Error("Order not found in page scope");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.orderId}, 0))`;
    if (order.status === "CANCELLED") return order;
    if (!['CONFIRMED', 'UPDATED'].includes(order.status)) throw new Error("Only confirmed orders can be cancelled");
    const revision = await tx.orderRevision.count({ where: { orderId: order.id } });
    const payload = { ...(order.payload as Record<string, unknown>), cancelled_at: new Date().toISOString() };
    const updated = await tx.order.update({ where: { id: order.id }, data: { status: "CANCELLED", payload: json(payload) } });
    await tx.orderRevision.create({ data: { orderId: order.id, revision, eventType: "CANCELLED", payload: json(payload), changedFields: json(["status"]) } });
    const telegram = await tx.pageTelegramSettings.findUnique({ where: { pageId: input.pageId }, select: { cancelledOrderEnabled: true } });
    if (telegram?.cancelledOrderEnabled) {
      const outbox = await tx.deliveryOutbox.create({ data: { pageId: input.pageId, deliveryKey: `${order.id}:${revision}:CANCELLED`, eventType: "CANCELLED_ORDER", revision, payload: json(payload) } });
      await tx.job.create({ data: { pageId: input.pageId, type: "PROCESS_TELEGRAM_DELIVERY", payload: json({ deliveryOutboxId: outbox.id }), idempotencyKey: `telegram:${order.id}:${revision}:CANCELLED` } });
    }
    return updated;
  });
}

export async function getPageOrders(pageId: string) {
  if (isDevPreview()) return getPreviewOrders(pageId);
  return prisma.order.findMany({ where: { pageId }, orderBy: { createdAt: "desc" }, take: 100, include: { revisions: { orderBy: { revision: "desc" }, take: 1 } } });
}

export async function getGlobalOrders(options: { pageId?: string; status?: string; search?: string; cursor?: string; limit?: number } = {}) {
  if (isDevPreview()) return [];
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const search = options.search?.trim();
  const rows = await prisma.order.findMany({ where: { ...(options.pageId ? { pageId: options.pageId } : {}), ...(options.status ? { status: options.status } : {}), ...(options.cursor ? { id: { lt: options.cursor } } : {}), ...(search ? { OR: [{ customerName: { contains: search, mode: "insensitive" } }, { normalizedPhone: { contains: search } }, { productName: { contains: search, mode: "insensitive" } }] } : {}) }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1, include: { page: { select: { id: true, name: true, slug: true } }, customer: { select: { id: true, name: true, phone: true } }, revisions: { orderBy: { revision: "desc" }, take: 1 } } });
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  return { items, nextCursor: hasMore ? items.at(-1)?.id ?? null : null };
}
