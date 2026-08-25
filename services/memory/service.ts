import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { AiResponse } from "@/lib/validation/ai";
import { normalizePhone } from "@/services/orders/phone";

/** AI may only propose keys in this controlled registry. */
export const MEMORY_FACT_REGISTRY = {
  name: { kind: "text", repeatAsk: false, correction: true, prompt: true },
  phone: { kind: "phone", repeatAsk: false, correction: true, prompt: true },
  address: { kind: "text", repeatAsk: false, correction: true, expires: true, prompt: true },
  delivery_area: { kind: "text", repeatAsk: false, correction: true, expires: true, prompt: true },
  language_preference: { kind: "text", repeatAsk: false, correction: true, expires: true, prompt: true },
  hair_problem: { kind: "text", repeatAsk: true, correction: true, expires: true, prompt: true },
  chemical_treatment: { kind: "text", repeatAsk: true, correction: true, expires: true, prompt: true },
  hair_type: { kind: "text", repeatAsk: true, correction: true, expires: true, prompt: true },
  use_case: { kind: "text", repeatAsk: true, correction: true, expires: true, prompt: true },
  main_concern: { kind: "text", repeatAsk: true, correction: true, expires: true, prompt: true },
  preferred_product_type: { kind: "text", repeatAsk: true, correction: true, expires: true, prompt: true },
  budget: { kind: "text", repeatAsk: true, correction: true, expires: true, prompt: true },
  budget_range: { kind: "text", repeatAsk: true, correction: true, expires: true, prompt: true },
  preferred_size: { kind: "text", repeatAsk: true, correction: true, expires: true, prompt: true },
  preferred_color: { kind: "text", repeatAsk: true, correction: true, expires: true, prompt: true },
  active_order_session_id: { kind: "text", repeatAsk: false, correction: true, prompt: true },
} as const;

type FactKey = keyof typeof MEMORY_FACT_REGISTRY;
const factAliases: Record<string, FactKey> = { preferred_type: "preferred_product_type", product_type: "preferred_product_type", size: "preferred_size", color: "preferred_color", customer_name: "name", normalized_phone: "phone", delivery_address: "address", order_session_id: "active_order_session_id" };
const questionAliases: Record<string, FactKey> = { hair_problem: "hair_problem", hair_issue: "hair_problem", hair_concern: "hair_problem", chemical_treatment: "chemical_treatment", budget: "budget", budget_range: "budget_range", preferred_type: "preferred_product_type", preferred_product_type: "preferred_product_type", name: "name", phone: "phone", address: "address", delivery_area: "delivery_area" };

export const memorySchema = z.object({
  knownFacts: z.record(z.string(), z.unknown()).default({}),
  unconfirmedFacts: z.record(z.string(), z.unknown()).default({}),
  needs: z.array(z.string()).default([]),
  preferences: z.record(z.string(), z.unknown()).default({}),
  semanticQuestionsAsked: z.array(z.string()).default([]),
  recommendedProductIds: z.array(z.string()).default([]),
  rejectedProductIds: z.array(z.string()).default([]),
  activeOrderReference: z.string().nullable().default(null),
  summary: z.string().max(4000).default(""),
});
export type CustomerMemory = z.infer<typeof memorySchema>;
export function emptyMemory(): CustomerMemory { return { knownFacts: {}, unconfirmedFacts: {}, needs: [], preferences: {}, semanticQuestionsAsked: [], recommendedProductIds: [], rejectedProductIds: [], activeOrderReference: null, summary: "" }; }
function cleanKey(value: string) { return value.trim().toLowerCase().replace(/\s+/g, "_"); }

export function canonicalFactKey(value: string): FactKey | null {
  const key = cleanKey(value);
  return (Object.prototype.hasOwnProperty.call(MEMORY_FACT_REGISTRY, key) ? key : factAliases[key]) as FactKey | null;
}

/** Maps different phrasings to one semantic question key, including Bengali. */
export function canonicalQuestionKey(value: string | null | undefined): FactKey | null {
  if (!value) return null;
  const key = cleanKey(value);
  if (questionAliases[key]) return questionAliases[key];
  const text = value.normalize("NFKC").toLocaleLowerCase().replace(/[?!।,:;]+/g, " ").replace(/\s+/g, " ").trim();
  if (/hair|চুল/.test(text) && /problem|issue|concern|সমস্যা|সমস[্যয়]/.test(text)) return "hair_problem";
  if (/chemical|bleach|color|treatment|কেমিক্যাল|ট্রিটমেন্ট|রং/.test(text)) return "chemical_treatment";
  if (/budget|price range|দাম|বাজেট/.test(text)) return "budget";
  if (/phone|mobile|number|ফোন|মোবাইল|নম্বর/.test(text)) return "phone";
  if (/address|location|area|ঠিকানা|এলাকা/.test(text)) return "address";
  if (/name|নাম/.test(text)) return "name";
  if (/type|ধরন|টাইপ/.test(text) && /product|পণ্য|চুল/.test(text)) return "preferred_product_type";
  return canonicalFactKey(key);
}

function normalizeValue(key: FactKey, value: unknown, countryCode = "US"): unknown {
  if (typeof value === "string") {
    const cleaned = value.trim().replace(/\s+/g, " ");
    if (!cleaned) return null;
    if (MEMORY_FACT_REGISTRY[key].kind === "phone") return normalizePhone(cleaned, { countryCode })?.normalized ?? null;
    return cleaned;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  return null;
}
function displayValue(value: unknown) { return typeof value === "string" ? value : value == null ? null : String(value); }
function isAmbiguous(value: unknown, confidence?: number) { return (confidence !== undefined && confidence < 0.8) || (typeof value === "string" && /\b(maybe|probably|possibly|might|হয়তো|সম্ভবত|মনে হয়)\b/i.test(value)); }
function json(value: unknown) { return value as Prisma.InputJsonValue; }

export function applyFactUpdates(current: unknown, updates: AiResponse["fact_updates"], countryCode = "US"): CustomerMemory {
  const memory = memorySchema.parse(current ?? emptyMemory());
  for (const update of updates) {
    const key = canonicalFactKey(update.key);
    if (!key) continue;
    if (update.operation === "CLEAR" || update.value === null || update.value === "") { delete memory.knownFacts[key]; delete memory.unconfirmedFacts[key]; continue; }
    const normalized = normalizeValue(key, update.value, countryCode);
    if (normalized === null) continue;
    if (isAmbiguous(update.value, update.confidence)) memory.unconfirmedFacts[key] = normalized;
    else { memory.knownFacts[key] = normalized; delete memory.unconfirmedFacts[key]; }
  }
  return memory;
}

export function markQuestionAsked(memoryInput: unknown, key: string | null | undefined) {
  const memory = memorySchema.parse(memoryInput ?? emptyMemory());
  const canonical = canonicalQuestionKey(key);
  if (canonical && !memory.semanticQuestionsAsked.includes(canonical)) memory.semanticQuestionsAsked.push(canonical);
  return memory;
}
export function shouldAsk(memoryInput: unknown, key: string) {
  const memory = memorySchema.parse(memoryInput ?? emptyMemory());
  const canonical = canonicalQuestionKey(key);
  if (!canonical) return false;
  return !memory.semanticQuestionsAsked.includes(canonical) && memory.knownFacts[canonical] === undefined;
}

type MemoryUpdateInput = { pageId: string; customerId: string; updates: AiResponse["fact_updates"]; askedQuestionKey?: string | null; countryCode?: string; sourceMessageId?: string; sourceType?: "AI_EXTRACTION" | "ADMIN_CORRECTION" | "CUSTOMER_CONFIRMED" };

async function updateCustomerMemoryOnce(input: MemoryUpdateInput) {
  return prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findFirst({ where: { id: input.customerId, pageId: input.pageId }, include: { memory: true } });
    if (!customer) throw new Error("Customer does not belong to page");
    if (input.sourceMessageId) {
      const source = await tx.message.findFirst({ where: { id: input.sourceMessageId, pageId: input.pageId, conversation: { customerId: customer.id } }, select: { id: true } });
      if (!source) throw new Error("Memory source message does not belong to page/customer");
    }
    const row = await tx.customerMemory.upsert({ where: { customerId: customer.id }, update: {}, create: { customerId: customer.id, memory: json(emptyMemory()) } });
    const sourceKeys = [...new Set(input.updates.map((update) => canonicalFactKey(update.key)).filter((key): key is FactKey => Boolean(key)))];
    if (input.sourceMessageId && sourceKeys.length) {
      const processed = await tx.customerMemoryFact.count({ where: { customerId: customer.id, sourceMessageId: input.sourceMessageId, factKey: { in: sourceKeys } } });
      if (processed === sourceKeys.length) return tx.customerMemory.findUniqueOrThrow({ where: { id: row.id }, include: { facts: { orderBy: { updatedAt: "desc" } } } });
    }
    // Lock the one memory row for this customer. This serializes retries and concurrent workers without Redis.
    await tx.customerMemory.update({ where: { id: row.id }, data: { version: { increment: 1 } } });
    let memory = memorySchema.parse(row.memory ?? emptyMemory());
    const activeFacts = await tx.customerMemoryFact.findMany({ where: { pageId: input.pageId, customerId: customer.id, status: { in: ["ACTIVE", "UNCONFIRMED"] } } });
    let changed = false;
    const sourceType = input.sourceType ?? "AI_EXTRACTION";
    for (const update of input.updates) {
      const key = canonicalFactKey(update.key);
      if (!key) continue;
      if (input.sourceMessageId && await tx.customerMemoryFact.findFirst({ where: { customerId: customer.id, sourceMessageId: input.sourceMessageId, factKey: key }, select: { id: true } })) continue;
      const current = activeFacts.find((fact) => fact.factKey === key && fact.status === "ACTIVE");
      const normalized = update.operation === "CLEAR" ? null : normalizeValue(key, update.value, input.countryCode);
      if (update.operation === "CLEAR" || normalized === null) {
        if (current) await tx.customerMemoryFact.update({ where: { id: current.id }, data: { status: "REJECTED", lastConfirmedAt: new Date() } });
        delete memory.knownFacts[key]; delete memory.unconfirmedFacts[key]; changed = Boolean(current) || changed; continue;
      }
      const ambiguous = isAmbiguous(update.value, update.confidence);
      if (ambiguous || (current && JSON.stringify(current.normalizedValue) !== JSON.stringify(normalized) && update.operation !== "CORRECT")) {
        await tx.customerMemoryFact.create({ data: { id: crypto.randomUUID(), pageId: input.pageId, customerId: customer.id, factKey: key, normalizedValue: json(normalized), displayValue: displayValue(normalized), sourceMessageId: input.sourceMessageId, sourceType, confidence: update.confidence, status: "UNCONFIRMED" } });
        memory.unconfirmedFacts[key] = normalized; changed = true; continue;
      }
      if (current && JSON.stringify(current.normalizedValue) === JSON.stringify(normalized)) {
        await tx.customerMemoryFact.update({ where: { id: current.id }, data: { lastConfirmedAt: new Date(), confidence: update.confidence ?? undefined } });
      } else {
        if (current) await tx.customerMemoryFact.update({ where: { id: current.id }, data: { status: "SUPERSEDED" } });
        const next = await tx.customerMemoryFact.create({ data: { id: crypto.randomUUID(), pageId: input.pageId, customerId: customer.id, factKey: key, normalizedValue: json(normalized), displayValue: displayValue(normalized), sourceMessageId: input.sourceMessageId, sourceType, confidence: update.confidence, status: "ACTIVE", lastConfirmedAt: new Date(), expiresAt: ("expires" in MEMORY_FACT_REGISTRY[key]) ? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) : undefined } });
        if (current) await tx.customerMemoryFact.update({ where: { id: current.id }, data: { supersededByFactId: next.id } });
      }
      memory.knownFacts[key] = normalized; delete memory.unconfirmedFacts[key]; changed = true;
    }
    const canonicalQuestion = canonicalQuestionKey(input.askedQuestionKey);
    if (canonicalQuestion && !memory.semanticQuestionsAsked.includes(canonicalQuestion)) { memory.semanticQuestionsAsked.push(canonicalQuestion); changed = true; }
    if (changed) {
      memory = memorySchema.parse(memory);
      await tx.customerMemory.update({ where: { id: row.id }, data: { memory: json(memory), summaryStale: true } });
      const touchedKeys = new Set(input.updates.map((update) => canonicalFactKey(update.key)).filter(Boolean));
      const profileData: Prisma.CustomerUpdateInput = {};
      if (touchedKeys.has("name")) profileData.name = typeof memory.knownFacts.name === "string" ? memory.knownFacts.name : null;
      if (touchedKeys.has("address")) profileData.address = typeof memory.knownFacts.address === "string" ? memory.knownFacts.address : null;
      if (touchedKeys.has("phone")) { const phone = typeof memory.knownFacts.phone === "string" ? normalizePhone(memory.knownFacts.phone, { countryCode: input.countryCode }) : null; profileData.phone = phone?.normalized ?? null; profileData.phoneOriginal = phone?.original ?? null; }
      if (Object.keys(profileData).length) await tx.customer.update({ where: { id: customer.id }, data: profileData });
    }
    return tx.customerMemory.findUniqueOrThrow({ where: { id: row.id }, include: { facts: { orderBy: { updatedAt: "desc" } } } });
  });
}

export async function updateCustomerMemory(input: MemoryUpdateInput) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await updateCustomerMemoryOnce(input); }
    catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code) && attempt < 2) continue; throw error; }
  }
  throw new Error("Memory update could not be committed safely");
}

export async function getPageCustomerMemory(pageId: string, customerId: string) {
  const customer = await prisma.customer.findFirst({ where: { id: customerId, pageId }, include: { memory: { include: { facts: { where: { pageId }, orderBy: { updatedAt: "desc" } } } } } });
  if (!customer) return null;
  return { customerId: customer.id, pageId: customer.pageId, memory: memorySchema.parse(customer.memory?.memory ?? emptyMemory()), facts: customer.memory?.facts ?? [] };
}

export async function editCustomerFact(input: { pageId: string; customerId: string; factKey: string; value: unknown; adminId?: string; countryCode?: string }) {
  const key = canonicalFactKey(input.factKey); if (!key) throw new Error("Unsupported memory fact key");
  const result = await updateCustomerMemory({ pageId: input.pageId, customerId: input.customerId, updates: [{ key, value: input.value, operation: "CORRECT", confidence: 1 }], sourceType: "ADMIN_CORRECTION", countryCode: input.countryCode });
  if (input.adminId) await prisma.auditLog.create({ data: { adminId: input.adminId, pageId: input.pageId, action: "customer.memory_fact_corrected", metadata: { customerId: input.customerId, factKey: key } } });
  return result;
}
export async function removeCustomerFact(input: { pageId: string; customerId: string; factKey: string; adminId?: string; countryCode?: string }) {
  const key = canonicalFactKey(input.factKey); if (!key) throw new Error("Unsupported memory fact key");
  const result = await updateCustomerMemory({ pageId: input.pageId, customerId: input.customerId, updates: [{ key, value: null, operation: "CLEAR" }], sourceType: "ADMIN_CORRECTION", countryCode: input.countryCode });
  if (input.adminId) await prisma.auditLog.create({ data: { adminId: input.adminId, pageId: input.pageId, action: "customer.memory_fact_removed", metadata: { customerId: input.customerId, factKey: key } } });
  return result;
}
export async function markCustomerFactUnknown(input: { pageId: string; customerId: string; factKey: string; adminId?: string }) {
  const key = canonicalFactKey(input.factKey); if (!key) throw new Error("Unsupported memory fact key");
  const result = await prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findFirst({ where: { id: input.customerId, pageId: input.pageId }, include: { memory: true } });
    if (!customer) throw new Error("Customer does not belong to page");
    const active = await tx.customerMemoryFact.findFirst({ where: { pageId: input.pageId, customerId: customer.id, factKey: key, status: "ACTIVE" }, orderBy: { updatedAt: "desc" } });
    const memory = memorySchema.parse(customer.memory?.memory ?? emptyMemory());
    if (active) await tx.customerMemoryFact.update({ where: { id: active.id }, data: { status: "REJECTED", lastConfirmedAt: new Date() } });
    delete memory.knownFacts[key]; delete memory.unconfirmedFacts[key];
    await tx.customerMemory.upsert({ where: { customerId: customer.id }, update: { memory: json(memory), version: { increment: 1 }, summaryStale: true }, create: { customerId: customer.id, memory: json(memory), version: 1, summaryStale: true } });
    if (key === "name" || key === "address" || key === "phone") {
      await tx.customer.update({ where: { id: customer.id }, data: key === "name" ? { name: null } : key === "address" ? { address: null } : { phone: null, phoneOriginal: null } });
    }
    if (input.adminId) await tx.auditLog.create({ data: { adminId: input.adminId, pageId: input.pageId, action: "customer.memory_fact_marked_unknown", metadata: { customerId: input.customerId, factKey: key } } });
    return memory;
  });
  return { customerId: input.customerId, pageId: input.pageId, memory: result };
}
export async function clearNonOrderMemory(input: { pageId: string; customerId: string; adminId?: string }) {
  return prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findFirst({ where: { id: input.customerId, pageId: input.pageId }, include: { memory: true } });
    if (!customer) throw new Error("Customer does not belong to page");
    const memory = memorySchema.parse(customer.memory?.memory ?? emptyMemory());
    await tx.customerMemoryFact.updateMany({ where: { pageId: input.pageId, customerId: input.customerId, factKey: { not: "active_order_session_id" }, status: { in: ["ACTIVE", "UNCONFIRMED"] } }, data: { status: "REJECTED" } });
    const next = { ...emptyMemory(), activeOrderReference: memory.activeOrderReference };
    await tx.customerMemory.upsert({ where: { customerId: input.customerId }, update: { memory: json(next), version: { increment: 1 }, summaryStale: true }, create: { customerId: input.customerId, memory: json(next), summaryStale: true } });
    if (input.adminId) await tx.auditLog.create({ data: { adminId: input.adminId, pageId: input.pageId, action: "customer.memory_non_order_cleared", metadata: { customerId: input.customerId } } });
    return next;
  });
}

/** Deterministic, bounded rebuild used by the Memory Inspector. It is a
 * compression aid only and can never create or supersede authoritative facts. */
export async function rebuildCustomerSummary(input: { pageId: string; customerId: string; adminId?: string }) {
  return prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findFirst({ where: { id: input.customerId, pageId: input.pageId }, include: { memory: true } });
    if (!customer) throw new Error("Customer does not belong to page");
    const memory = memorySchema.parse(customer.memory?.memory ?? emptyMemory());
    const messages = await tx.message.findMany({ where: { pageId: input.pageId, conversation: { customerId: input.customerId }, text: { not: null } }, orderBy: { createdAt: "desc" }, take: 4, select: { id: true, direction: true, text: true } });
    const facts = Object.entries(memory.knownFacts).map(([key, value]) => `${key}=${displayValue(value)}`).join("; ");
    const turns = messages.reverse().map((message) => `${message.direction.toLowerCase()}: ${(message.text ?? "").slice(0, 240)}`).join(" | ");
    const summary = [`Known facts: ${facts || "none"}`, turns ? `Recent turns: ${turns}` : ""].filter(Boolean).join("\n").slice(0, 4000);
    const next = { ...memory, summary };
    const updated = await tx.customerMemory.upsert({ where: { customerId: input.customerId }, update: { memory: json(next), summaryVersion: { increment: 1 }, summaryLastMessageId: messages.at(-1)?.id, summaryGeneratedAt: new Date(), summaryStale: false }, create: { customerId: input.customerId, memory: json(next), summaryVersion: 1, summaryLastMessageId: messages.at(-1)?.id, summaryGeneratedAt: new Date(), summaryStale: false } });
    if (input.adminId) await tx.auditLog.create({ data: { adminId: input.adminId, pageId: input.pageId, action: "customer.memory_summary_rebuilt", metadata: { customerId: input.customerId } } });
    return { ...updated, memory: memorySchema.parse(updated.memory) };
  });
}
