import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";

export const deletionRequestSchema = z.object({
  pageId: z.string().uuid(),
  customerId: z.string().uuid(),
  requestKey: z.string().trim().min(8).max(160).regex(/^[A-Za-z0-9._:-]+$/),
});
export type DeletionRequest = z.infer<typeof deletionRequestSchema>;

const personalKeys = new Set(["name", "customer_name", "phone", "phone_original", "normalized_phone", "address", "full_address", "email", "facebook_psid", "sender_psid"]);
export function anonymizeOrderPayload(value: unknown): Prisma.InputJsonValue {
  if (Array.isArray(value)) return value.map((item) => anonymizeOrderPayload(item)) as Prisma.InputJsonValue;
  if (value && typeof value === "object") {
    const output: Record<string, Prisma.InputJsonValue> = {};
    for (const [key, item] of Object.entries(value)) output[key] = personalKeys.has(key.toLowerCase()) ? "[REMOVED]" : anonymizeOrderPayload(item);
    return output;
  }
  if (value === null) return "[REMOVED]";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return "[REMOVED]";
}

export async function executeCustomerDataDeletion(input: DeletionRequest, adminId?: string) {
  const parsed = deletionRequestSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.dataDeletionRequest.upsert({
      where: { requestKey: parsed.requestKey },
      update: {},
      create: { id: crypto.randomUUID(), requestKey: parsed.requestKey, pageId: parsed.pageId, customerId: parsed.customerId, status: "PROCESSING" },
    });
    if (existing.pageId !== parsed.pageId || existing.customerId !== parsed.customerId) throw new Error("Deletion request identity mismatch");
    if (existing.status === "COMPLETED") return { requestKey: existing.requestKey, pageId: existing.pageId, customerId: existing.customerId, alreadyCompleted: true, ordersPreserved: existing.ordersPreserved };

    const customer = await tx.customer.findFirst({ where: { id: parsed.customerId, pageId: parsed.pageId }, select: { id: true } });
    if (!customer) throw new Error("Customer does not belong to page");
    const orders = await tx.order.findMany({ where: { pageId: parsed.pageId, customerId: customer.id }, select: { id: true, payload: true } });
    for (const order of orders) {
      await tx.order.update({ where: { id: order.id }, data: { customerId: null, customerName: null, normalizedPhone: null, phoneOriginal: null, fullAddress: null, payload: anonymizeOrderPayload(order.payload) } });
      const revisions = await tx.orderRevision.findMany({ where: { orderId: order.id }, select: { id: true, payload: true, changedFields: true } });
      for (const revision of revisions) await tx.orderRevision.update({ where: { id: revision.id }, data: { payload: anonymizeOrderPayload(revision.payload), changedFields: revision.changedFields === null ? Prisma.JsonNull : anonymizeOrderPayload(revision.changedFields) } });
    }
    await tx.orderSession.updateMany({ where: { pageId: parsed.pageId, customerId: customer.id }, data: { customerId: null, state: { data_removed: true } } });
    await tx.conversation.deleteMany({ where: { pageId: parsed.pageId, customerId: customer.id } });
    await tx.customer.delete({ where: { id: customer.id } });
    await tx.dataDeletionRequest.update({ where: { id: existing.id }, data: { status: "COMPLETED", ordersPreserved: orders.length, completedAt: new Date() } });
    await tx.auditLog.create({ data: { adminId, pageId: parsed.pageId, action: "customer.data_deleted", metadata: { requestKey: parsed.requestKey, customerId: parsed.customerId, ordersPreserved: orders.length } } });
    return { requestKey: parsed.requestKey, pageId: parsed.pageId, customerId: parsed.customerId, alreadyCompleted: false, ordersPreserved: orders.length };
  });
}
