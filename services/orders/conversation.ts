import { AiResponse } from "@/lib/validation/ai";
import { prisma } from "@/lib/db/prisma";
import { isClearConfirmation } from "@/services/orders/engine";
import { confirmDraft, cancelConfirmedOrder, updateDraft } from "@/services/orders/service";

type OrderSignalResult = { reply: string; orderTruth?: { reference: string; status: string; productName: string | null; variantDetails: { sku: string; size: string | null; color: string | null }; unitPrice: number; total: number; quantity: number | null; currency: string | null } } | null;

export async function applyOrderSignal(input: { pageId: string; customerId: string; text: string; result: AiResponse; requiredFields: string[]; currency: string; countryCode: string; configurationVersion?: number }): Promise<OrderSignalResult> {
  const cancellation = /^(cancel|cancel\s*order|cancel\s*kore\s*den|order\s*ta\s*bad\s*den|no\s*longer\s*need|lagbe\s*na|\u09ac\u09be\u09a4\u09bf\u09b2)[.!\s]*$/iu.test(input.text.trim());
  const completed = await prisma.orderSession.findFirst({ where: { pageId: input.pageId, customerId: input.customerId, status: "COMPLETED", orderId: { not: null } }, orderBy: { updatedAt: "desc" } });
  if (cancellation && completed?.orderId) {
    await cancelConfirmedOrder({ pageId: input.pageId, orderId: completed.orderId });
    return { reply: "Your confirmed order has been cancelled." };
  }
  if (input.result.order_action === "NONE" && !isClearConfirmation(input.text)) return null;

  const facts = Object.fromEntries(input.result.fact_updates.filter((fact) => fact.operation !== "CLEAR").map((fact) => [fact.key.toLowerCase(), fact.value]));
  const recommendedProductId = input.result.recommended_product_ids[0];
  const product = recommendedProductId ? await prisma.product.findFirst({ where: { id: recommendedProductId, pageId: input.pageId, active: true }, include: { variants: { where: { active: true }, orderBy: { createdAt: "asc" } } } }) : null;
  const variantFacts = new Map(input.result.fact_updates.map((fact) => [fact.key.trim().toLowerCase(), fact.value]));
  const rawRequestedSku = variantFacts.get("sku");
  const rawRequestedVariant = variantFacts.get("variant");
  const requestedSku = typeof rawRequestedSku === "string" ? rawRequestedSku : undefined;
  const requestedVariant = typeof rawRequestedVariant === "string" ? rawRequestedVariant : undefined;
  const variant = product?.variants.length === 1 ? product.variants[0] : product?.variants.find((candidate) => candidate.sku === requestedSku || [candidate.size, candidate.color].filter(Boolean).join(" ").toLowerCase() === requestedVariant?.toLowerCase());
  const patch: Record<string, unknown> = {};
  if (typeof facts.name === "string") patch.customerName = facts.name;
  if (typeof facts.phone === "string") patch.phone = facts.phone;
  if (typeof facts.address === "string") patch.fullAddress = facts.address;
  if (typeof facts.quantity === "number" && Number.isInteger(facts.quantity)) patch.quantity = facts.quantity;
  if (product && variant) { patch.productId = product.id; patch.productName = product.name; patch.variantId = variant.id; patch.variantDetails = { sku: variant.sku, size: variant.size, color: variant.color }; patch.unitPrice = Number(variant.currentPrice); patch.priceAtDraft = Number(variant.currentPrice); patch.currency = input.currency; patch.configurationVersion = input.configurationVersion ?? null; }
  if (Object.keys(patch).length > 0 || input.result.order_action !== "NONE") await updateDraft({ pageId: input.pageId, customerId: input.customerId, patch, countryCode: input.countryCode });
  if (!isClearConfirmation(input.text)) return input.result.order_action === "CONFIRM" ? { reply: "Please reply clearly with Yes to confirm, or No to cancel." } : null;

  const session = await prisma.orderSession.findFirst({ where: { pageId: input.pageId, customerId: input.customerId, status: "ACTIVE" }, orderBy: { updatedAt: "desc" } });
  const draft = session?.state as { productId?: string; variantId?: string } | undefined;
  if (!draft?.productId || !draft.variantId) return { reply: "I still need the product and variant before I can confirm the order." };
  const truth = await prisma.product.findFirst({ where: { id: draft.productId, pageId: input.pageId, active: true }, include: { variants: { where: { id: draft.variantId, active: true } } } });
  const currentVariant = truth?.variants[0];
  if (!truth || !currentVariant) return { reply: "That product or variant is no longer available. Please choose an active product again." };
  try {
    const order = await confirmDraft({ pageId: input.pageId, customerId: input.customerId, product: { id: truth.id, name: truth.name, active: truth.active, variant: { id: currentVariant.id, sku: currentVariant.sku, size: currentVariant.size, color: currentVariant.color, active: currentVariant.active, price: Number(currentVariant.currentPrice) } }, requiredFields: input.requiredFields, currency: input.currency, configurationVersion: input.configurationVersion, countryCode: input.countryCode });
    return {
      reply: `Your order is confirmed. Order reference: ${order.id}. Product: ${order.productName ?? truth.name}. Variant: ${[currentVariant.sku, currentVariant.size, currentVariant.color].filter(Boolean).join(" / ")}. Quantity: ${order.quantity ?? 0}. Unit price: ${order.unitPrice?.toString() ?? currentVariant.currentPrice.toString()} ${order.currency ?? input.currency}. Total: ${order.total?.toString() ?? "0"} ${order.currency ?? input.currency}.`,
      orderTruth: {
        reference: order.id,
        status: order.status,
        productName: order.productName,
        variantDetails: { sku: currentVariant.sku, size: currentVariant.size, color: currentVariant.color },
        unitPrice: Number(order.unitPrice ?? currentVariant.currentPrice),
        total: Number(order.total ?? 0),
        quantity: order.quantity,
        currency: order.currency,
      },
    };
  } catch (error) {
    return { reply: error instanceof Error && /price changed/i.test(error.message) ? "The product price changed. I updated the draft with the current price; please confirm again." : "I still need the remaining required details before I can confirm the order." };
  }
}
