import { AiCallType } from "@prisma/client";
import { businessParseSchema, BusinessParse } from "@/lib/validation/ai";
import { AiProvider, runStructuredAi } from "@/services/ai/provider";
import { redactSensitiveText } from "@/lib/logging/logger";

export async function analyzeBusiness(input: { pageId: string; rawBusinessInfo: string; provider: AiProvider }) {
  const fallback: BusinessParse = { business_profile: { business_name: null, description: null, benefits: [] }, products: [], policies: { delivery: null, cod: null, faq: [] }, sales_instructions: null, order_requirements: [], unknown_information: ["Business information could not be parsed; review the draft manually."], conflicts: [] };
  return runStructuredAi({ pageId: input.pageId, provider: input.provider, callType: "BUSINESS_PARSE" as AiCallType, system: "Extract a reviewable business draft. Never invent missing facts. Return only JSON matching the schema.", user: redactSensitiveText(input.rawBusinessInfo), schema: businessParseSchema, fallback });
}

export function normalizeBusinessParse(parsed: BusinessParse): BusinessParse {
  const normalized = { ...parsed, business_profile: { ...parsed.business_profile, business_name: parsed.business_profile.business_name?.trim() || null, description: parsed.business_profile.description?.trim() || null, benefits: parsed.business_profile.benefits.map((value) => value.trim()).filter(Boolean) }, products: parsed.products.map((product) => ({ ...product, name: product.name.trim(), tags: [...new Set(product.tags.map((tag) => tag.trim().toLocaleLowerCase()).filter(Boolean))], variants: product.variants.map((variant) => ({ ...variant, sku: variant.sku.trim() })) })), conflicts: parsed.conflicts.map((conflict) => ({ ...conflict, field: conflict.field.trim(), details: conflict.details.trim() })) };
  const seenSkus = new Map<string, number>();
  for (const product of normalized.products) for (const variant of product.variants) { const prior = seenSkus.get(variant.sku); if (prior !== undefined && prior !== variant.current_price) normalized.conflicts.push({ field: `variant:${variant.sku}`, details: "The same SKU has conflicting prices in the source information.", critical: true }); else seenSkus.set(variant.sku, variant.current_price); }
  return normalized;
}
