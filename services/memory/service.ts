import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { AiResponse } from "@/lib/validation/ai";
import { normalizePhone } from "@/services/orders/phone";

export const memorySchema = z.object({
  knownFacts: z.record(z.string(), z.unknown()).default({}),
  needs: z.array(z.string()).default([]),
  preferences: z.record(z.string(), z.unknown()).default({}),
  semanticQuestionsAsked: z.array(z.string()).default([]),
  recommendedProductIds: z.array(z.string()).default([]),
  rejectedProductIds: z.array(z.string()).default([]),
  activeOrderReference: z.string().nullable().default(null),
  summary: z.string().max(4000).default(""),
});
export type CustomerMemory = z.infer<typeof memorySchema>;

export function emptyMemory(): CustomerMemory { return { knownFacts: {}, needs: [], preferences: {}, semanticQuestionsAsked: [], recommendedProductIds: [], rejectedProductIds: [], activeOrderReference: null, summary: "" }; }
function normalize(value: unknown) { return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : value; }

export function applyFactUpdates(current: unknown, updates: AiResponse["fact_updates"]): CustomerMemory {
  const memory = memorySchema.parse(current ?? emptyMemory());
  for (const update of updates) {
    const key = update.key.trim().toLowerCase();
    if (!key) continue;
    if (update.operation === "CLEAR" || update.value === null || update.value === "") delete memory.knownFacts[key];
    else memory.knownFacts[key] = normalize(update.value);
  }
  return memory;
}

export function markQuestionAsked(memoryInput: unknown, key: string | null | undefined) {
  const memory = memorySchema.parse(memoryInput ?? emptyMemory());
  if (key && !memory.semanticQuestionsAsked.includes(key)) memory.semanticQuestionsAsked.push(key);
  return memory;
}

export function shouldAsk(memoryInput: unknown, key: string) {
  const memory = memorySchema.parse(memoryInput ?? emptyMemory());
  return !memory.semanticQuestionsAsked.includes(key) && memory.knownFacts[key] === undefined;
}

export async function updateCustomerMemory(input: { pageId: string; customerId: string; updates: AiResponse["fact_updates"]; askedQuestionKey?: string | null; countryCode?: string }) {
  return prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findFirst({ where: { id: input.customerId, pageId: input.pageId }, include: { memory: true } });
    if (!customer) throw new Error("Customer does not belong to page");
    let memory = applyFactUpdates(customer.memory?.memory, input.updates);
    memory = markQuestionAsked(memory, input.askedQuestionKey);
    const facts = memory.knownFacts;
    const normalizedPhone = typeof facts.phone === "string" ? normalizePhone(facts.phone, { countryCode: input.countryCode }) : null;
    await tx.customer.update({ where: { id: customer.id }, data: { name: typeof facts.name === "string" ? facts.name : undefined, phone: normalizedPhone?.normalized, phoneOriginal: normalizedPhone?.original, address: typeof facts.address === "string" ? facts.address : undefined } });
    return tx.customerMemory.upsert({ where: { customerId: customer.id }, update: { memory: memory as unknown as import("@prisma/client").Prisma.InputJsonValue }, create: { customerId: customer.id, memory: memory as unknown as import("@prisma/client").Prisma.InputJsonValue } });
  });
}
