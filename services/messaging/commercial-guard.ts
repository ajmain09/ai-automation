import { prisma } from "@/lib/db/prisma";

export type CommercialReplyStatus = "SAFE_TO_SEND" | "CORRECTED" | "REGENERATE" | "BLOCKED";

export type OrderTruth = {
  reference?: string | null;
  status?: string | null;
  productName?: string | null;
  variantDetails?: { sku?: string | null; size?: string | null; color?: string | null } | null;
  unitPrice?: number | null;
  total?: number | null;
  quantity?: number | null;
  currency?: string | null;
};

export type CommercialGuardInput = {
  pageId: string;
  generatedReply: string;
  recommendedProductIds?: string[];
  generatedConfigurationVersion?: number;
  currentOrderState?: OrderTruth | null;
};

export type CommercialGuardResult = {
  status: CommercialReplyStatus;
  reply: string;
  reason?: string;
  liveConfigurationVersion: number | null;
};

type VariantTruth = {
  id: string;
  sku: string;
  size: string | null;
  color: string | null;
  currentPrice: number;
  oldPrice: number | null;
  stockStatus: string;
  active: boolean;
};

type ProductTruth = { id: string; name: string; active: boolean; variants: VariantTruth[] };

const normalized = (value: string) => value.toLocaleLowerCase().replace(/[‐‑‒–—−]/g, "-").replace(/\s+/g, " ").trim();
const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const contains = (text: string, value: string | null | undefined) => Boolean(value && normalized(text).includes(normalized(value)));
const numbers = (text: string) => [...text.matchAll(/(?:৳|\b(?:bdt|tk|taka)\.?\s*)?\b(\d+(?:\.\d{1,2})?)\b/giu)].map((match) => Number(match[1]));
const sameNumber = (left: number, right: number) => Math.abs(left - right) < 0.005;

function canonicalPolicyUnknown(policy: string | null | undefined, unknownInformation: string[], terms: string[]) {
  if (!policy?.trim()) return true;
  const unknown = unknownInformation.map(normalized).join(" ");
  return terms.some((term) => unknown.includes(term));
}

function policyPolarity(value: string) {
  const text = normalized(value);
  if (/\b(not|no|without|unavailable|unavailable|doesn't|dont|don't|isn't|isnt|cannot|can't)\b/u.test(text)) return false;
  if (/\b(available|yes|accepted|accept|provided|offered|supported|included|free)\b/u.test(text)) return true;
  return null;
}

function claimPolarity(value: string) {
  return policyPolarity(value);
}

function policyClaim(text: string, terms: string[]) {
  const lower = normalized(text);
  const index = terms.map((term) => lower.indexOf(term)).filter((item) => item >= 0).sort((a, b) => a - b)[0];
  return index === undefined ? "" : lower.slice(Math.max(0, index - 40), Math.min(lower.length, index + 180));
}

function replaceNumbers(text: string, expected: number[], actual: number[]) {
  if (expected.length !== actual.length || !expected.length) return null;
  let result = text;
  for (let index = 0; index < expected.length; index += 1) {
    const pattern = new RegExp(`((?:৳|\\b(?:bdt|tk|taka)\\.?\\s*)?)${escaped(String(expected[index]))}(?=\\b|[^\\d])`, "iu");
    if (!pattern.test(result)) return null;
    result = result.replace(pattern, (_, prefix: string) => `${prefix}${actual[index].toFixed(actual[index] % 1 ? 2 : 0)}`);
  }
  return result;
}

function safeOrderReply(order: OrderTruth) {
  const fields = [
    order.productName ? `Product: ${order.productName}` : null,
    order.variantDetails?.sku || order.variantDetails?.size || order.variantDetails?.color
      ? `Variant: ${[order.variantDetails.sku, order.variantDetails.size, order.variantDetails.color].filter(Boolean).join(" / ")}`
      : null,
    order.quantity !== null && order.quantity !== undefined ? `Quantity: ${order.quantity}` : null,
    order.unitPrice !== null && order.unitPrice !== undefined ? `Unit price: ${order.unitPrice} ${order.currency ?? ""}`.trim() : null,
    order.total !== null && order.total !== undefined ? `Total: ${order.total} ${order.currency ?? ""}`.trim() : null,
  ].filter(Boolean);
  return fields.length ? `I can confirm the current order details: ${fields.join(". ")}.` : "I can confirm the current order details from the backend. Please review them before proceeding.";
}

function validateOrderText(text: string, order: OrderTruth) {
  const lower = normalized(text);
  if (order.reference && /\b(order\s*(reference|ref|id|number|no\.?|#)|reference\s*[:#]?)/iu.test(lower)) {
    const reference = lower.includes(normalized(order.reference));
    if (!reference) return "Order reference does not match the backend order snapshot";
  }
  if (order.productName && /\b(product|item|order)\b/iu.test(lower) && !contains(lower, order.productName)) return "Order product does not match the backend order snapshot";
  const details = order.variantDetails;
  if (details?.sku && /\b(sku|variant)\b/iu.test(lower) && !contains(lower, details.sku)) return "Order SKU does not match the backend order snapshot";
  if (details?.size && /\b(size|variant)\b/iu.test(lower) && !contains(lower, details.size)) return "Order size does not match the backend order snapshot";
  if (details?.color && /\b(color|variant)\b/iu.test(lower) && !contains(lower, details.color)) return "Order color does not match the backend order snapshot";
  if (order.quantity !== null && order.quantity !== undefined && /\b(quantity|qty|pieces?|units?|x\s*\d+)\b/iu.test(lower)) {
    const quantities = [...lower.matchAll(/\b(?:quantity|qty|pieces?|units?|x)\s*[:#]?\s*(\d+)\b/giu)].map((match) => Number(match[1]));
    if (quantities.length && quantities.some((value) => value !== order.quantity)) return "Order quantity does not match the backend order snapshot";
  }
  if (order.status && /\b(confirm(?:ed|ation)?|cancel(?:led|lation)?|pending|updated)\b/iu.test(lower)) {
    const expected = normalized(order.status).replace("cancelled", "canceled");
    const statusClaim = lower.match(/\b(confirm(?:ed|ation)?|cancel(?:led|lation)?|pending|updated)\b/iu)?.[1] ?? "";
    const claimed = statusClaim.startsWith("cancel") ? "canceled" : statusClaim.startsWith("confirm") ? "confirmed" : statusClaim;
    if (!expected.includes(claimed)) return "Order status does not match the backend order snapshot";
  }
  for (const [label, expected] of [["unit price", order.unitPrice], ["total", order.total] ] as const) {
    if (expected === null || expected === undefined) continue;
    const match = new RegExp(`\\b${label}\\s*[:#-]?\\s*(?:৳|\\b(?:bdt|tk|taka)\\.?\\s*)?(\\d+(?:\\.\\d{1,2})?)`, "iu").exec(lower);
    if (match && !sameNumber(Number(match[1]), expected)) return `Order ${label} does not match the backend order snapshot`;
  }
  return null;
}

export async function validateAndCorrectCommercialReply(input: CommercialGuardInput): Promise<CommercialGuardResult> {
  const live = await prisma.configurationVersion.findFirst({ where: { pageId: input.pageId, status: "LIVE" }, select: { version: true, businessData: true } });
  if (!live) return { status: "BLOCKED", reply: "I’m sorry, the current Page information is not available right now.", reason: "No LIVE configuration", liveConfigurationVersion: null };
  if (input.generatedConfigurationVersion !== undefined && input.generatedConfigurationVersion !== live.version) return { status: "REGENERATE", reply: "", reason: "LIVE configuration changed during generation", liveConfigurationVersion: live.version };

  const ids = [...new Set(input.recommendedProductIds ?? [])];
  const rawProducts = await prisma.product.findMany({ where: { pageId: input.pageId }, include: { variants: true } });
  const products: ProductTruth[] = rawProducts.map((product) => ({ id: product.id, name: product.name, active: product.active, variants: product.variants.map((variant) => ({ id: variant.id, sku: variant.sku, size: variant.size, color: variant.color, currentPrice: Number(variant.currentPrice), oldPrice: variant.oldPrice === null ? null : Number(variant.oldPrice), stockStatus: variant.stockStatus, active: variant.active })) }));
  const byId = new Map(products.map((product) => [product.id, product]));
  for (const id of ids) {
    const product = byId.get(id);
    if (!product?.active || !product.variants.some((variant) => variant.active)) return { status: "BLOCKED", reply: "That product is not currently available. Please choose from the active Page catalog.", reason: "Inactive or missing recommended product", liveConfigurationVersion: live.version };
  }

  const data = live.businessData && typeof live.businessData === "object" ? live.businessData as { policies?: { delivery?: string | null; cod?: string | null; return?: string | null; exchange?: string | null; open_parcel?: string | null; courier?: string | null; delivery_time?: string | null }; unknown_information?: string[] } : {};
  const business = await prisma.businessProfile.findUnique({ where: { pageId: input.pageId }, select: { deliveryPolicy: true, codPolicy: true, policies: true } });
  const businessPolicies = business?.policies && typeof business.policies === "object" ? business.policies as Record<string, unknown> : {};
  const policies = {
    delivery: data.policies?.delivery ?? business?.deliveryPolicy ?? (typeof businessPolicies.delivery === "string" ? businessPolicies.delivery : null),
    cod: data.policies?.cod ?? business?.codPolicy ?? (typeof businessPolicies.cod === "string" ? businessPolicies.cod : null),
    return: data.policies?.return ?? (typeof businessPolicies.return === "string" ? businessPolicies.return : null),
    exchange: data.policies?.exchange ?? (typeof businessPolicies.exchange === "string" ? businessPolicies.exchange : null),
    openParcel: data.policies?.open_parcel ?? (typeof businessPolicies.open_parcel === "string" ? businessPolicies.open_parcel : null),
    courier: data.policies?.courier ?? (typeof businessPolicies.courier === "string" ? businessPolicies.courier : null),
    deliveryTime: data.policies?.delivery_time ?? (typeof businessPolicies.delivery_time === "string" ? businessPolicies.delivery_time : null),
  };
  const unknownInformation = Array.isArray(data.unknown_information) ? data.unknown_information.map(String) : [];
  const text = input.generatedReply;
  const lower = normalized(text);
  const policyChecks: Array<{ terms: string[]; value: string | null | undefined; unknownTerms: string[]; label: string }> = [
    { terms: ["cash on delivery", "cod"], value: policies.cod, unknownTerms: ["cod", "cash on delivery"], label: "COD policy" },
    { terms: ["return", "exchange"], value: policies.return ?? policies.exchange, unknownTerms: ["return", "exchange"], label: "return/exchange policy" },
    { terms: ["open parcel", "open-package"], value: policies.openParcel, unknownTerms: ["open parcel", "open package"], label: "open parcel policy" },
    { terms: ["courier", "delivery partner"], value: policies.courier, unknownTerms: ["courier", "delivery partner"], label: "courier information" },
    { terms: ["delivery", "arrive", "business day", "working day"], value: policies.deliveryTime ?? policies.delivery, unknownTerms: ["delivery", "delivery time", "delivery date"], label: "delivery policy" },
  ];
  for (const check of policyChecks) {
    if (!check.terms.some((term) => lower.includes(term))) continue;
    if (check.label === "delivery policy" && !/(?:delivery\s*(?:takes|within|in|time|fee|charge|available|free|days?|hours?)|arriv|ship|business\s*day|working\s*day)/iu.test(lower)) continue;
    if (canonicalPolicyUnknown(check.value, unknownInformation, check.unknownTerms)) return { status: "BLOCKED", reply: "I’m sorry, that information is not currently confirmed for this Page.", reason: `${check.label} is UNKNOWN`, liveConfigurationVersion: live.version };
    const claim = policyClaim(text, check.terms);
    const canonicalPolarity = policyPolarity(check.value ?? "");
    const claimedPolarity = claimPolarity(claim);
    if (canonicalPolarity !== null && claimedPolarity !== null && canonicalPolarity !== claimedPolarity) return { status: "BLOCKED", reply: "I’m sorry, I can’t confirm that Page policy from the current configuration.", reason: `${check.label} conflicts with LIVE truth`, liveConfigurationVersion: live.version };
    if (check.label === "delivery policy" && /\b\d+\s*(?:-|to)\s*\d+\s*(?:business\s*)?(?:day|hour)|\b\d+\s*(?:business\s*)?(?:day|hour)/iu.test(text)) {
      const canonicalNumbers = numbers(check.value ?? "");
      const claimedNumbers = numbers(claim);
      if (canonicalNumbers.length && claimedNumbers.length && canonicalNumbers.slice(-2).join(",") !== claimedNumbers.slice(-2).join(",")) return { status: "BLOCKED", reply: "I’m sorry, the current delivery time is not the same as that message.", reason: "Delivery time conflicts with LIVE truth", liveConfigurationVersion: live.version };
    }
    const canonicalNumbers = numbers(check.value ?? "");
    const claimedNumbers = numbers(claim);
    if (canonicalNumbers.length && claimedNumbers.length && canonicalNumbers.slice(-2).join(",") !== claimedNumbers.slice(-2).join(",")) return { status: "BLOCKED", reply: "I’m sorry, that Page policy does not match the current configuration.", reason: `${check.label} conflicts with LIVE truth`, liveConfigurationVersion: live.version };
  }

  // Once an order exists, its persisted snapshot is authoritative even if the
  // catalog has since changed. Do not reinterpret an order confirmation as a
  // fresh product recommendation.
  if (input.currentOrderState && /\b(order\s*(reference|ref|id|number|no\.?|#)|your order|order is)\b/iu.test(lower)) {
    const orderIssue = validateOrderText(text, input.currentOrderState);
    if (orderIssue) return { status: "BLOCKED", reply: safeOrderReply(input.currentOrderState), reason: orderIssue, liveConfigurationVersion: live.version };
    return { status: "SAFE_TO_SEND", reply: text, liveConfigurationVersion: live.version };
  }

  const candidateProducts = products.filter((product) => ids.includes(product.id) || contains(text, product.name) || product.variants.some((variant) => contains(text, variant.sku)));
  const namedInactive = products.find((product) => !product.active && contains(text, product.name));
  if (namedInactive) return { status: "BLOCKED", reply: "That product is not currently available. Please choose from the active Page catalog.", reason: "Inactive product mentioned", liveConfigurationVersion: live.version };
  const candidate = candidateProducts.length === 1 ? candidateProducts[0] : ids.length === 1 ? byId.get(ids[0]) : null;
  const commercialCue = /(?:৳|\b(?:bdt|tk|taka|price|cost|costs|old price|was|now|discount|size|color|sku|stock|available|unavailable|sold out|preorder|pre-order|product|item)\b)/iu.test(text);
  if (commercialCue && !candidate && candidateProducts.length !== 1) return { status: "BLOCKED", reply: "I’m sorry, I can’t confirm that product information from the current Page catalog.", reason: "Commercial claim has no unambiguous Page product", liveConfigurationVersion: live.version };
  if (candidate) {
    const activeVariants = candidate.variants.filter((variant) => variant.active);
    const inactiveMention = candidate.variants.find((variant) => !variant.active && [variant.sku, variant.size, variant.color].some((value) => contains(text, value)));
    if (inactiveMention) return { status: "BLOCKED", reply: "That variant is not currently available. Please choose an active variant.", reason: "Inactive variant mentioned", liveConfigurationVersion: live.version };
    const mentionedVariant = activeVariants.find((variant) => [variant.sku, variant.size, variant.color].some((value) => contains(text, value)));
    const variant = mentionedVariant ?? (activeVariants.length === 1 ? activeVariants[0] : null);
    if (commercialCue && !activeVariants.length) return { status: "BLOCKED", reply: "That product has no active variants at the moment.", reason: "No active variant", liveConfigurationVersion: live.version };
    if (variant && /\b(size|color|sku|variant)\b/iu.test(text)) {
      const wrongVariantClaim = /\b(size|color|sku|variant)\s*[:#-]?\s*([\w-]+)/iu.exec(text)?.[2];
      if (wrongVariantClaim && ![variant.sku, variant.size, variant.color].filter(Boolean).some((value) => normalized(value as string) === normalized(wrongVariantClaim))) return { status: "BLOCKED", reply: "I’m sorry, that variant does not match the active Page catalog.", reason: "Variant claim conflicts with LIVE truth", liveConfigurationVersion: live.version };
    }
    const priceCue = /(?:৳|\b(?:bdt|tk|taka|price|cost|costs|discount|old price|was|now)\b)/iu.test(text);
    if (variant && priceCue) {
      const claimed = numbers(text);
      const expected = /\b(?:old price|was|regular)\b/iu.test(text) ? variant.oldPrice : variant.currentPrice;
      if (expected === null) return { status: "BLOCKED", reply: "I’m sorry, that price information is not currently confirmed.", reason: "Unknown canonical price", liveConfigurationVersion: live.version };
      if (!claimed.some((value) => sameNumber(value, expected))) {
        const replacement = replaceNumbers(text, claimed, [expected]);
        if (replacement) return { status: "CORRECTED", reply: replacement, reason: "Price corrected from LIVE catalog", liveConfigurationVersion: live.version };
        return { status: "BLOCKED", reply: "I’m sorry, the current product price is different from that message.", reason: "Price conflicts with LIVE truth", liveConfigurationVersion: live.version };
      }
    }
    const stockClaims: Record<string, RegExp> = { IN_STOCK: /\b(in stock|available|ready to ship)\b/iu, LOW_STOCK: /\b(low stock|limited stock|few left)\b/iu, OUT_OF_STOCK: /\b(out of stock|sold out|unavailable)\b/iu, PREORDER: /\bpre-?order\b/iu };
    const claimedStock = Object.entries(stockClaims).find(([, pattern]) => pattern.test(text))?.[0];
    if (claimedStock && claimedStock !== candidate.variants.find((item) => item.active)?.stockStatus) return { status: "BLOCKED", reply: "I’m sorry, the current stock status is different from that message.", reason: "Stock claim conflicts with LIVE truth", liveConfigurationVersion: live.version };
  }

  if (input.currentOrderState) {
    const orderIssue = validateOrderText(text, input.currentOrderState);
    if (orderIssue) return { status: "BLOCKED", reply: safeOrderReply(input.currentOrderState), reason: orderIssue, liveConfigurationVersion: live.version };
    const orderPriceCue = /(?:৳|\b(?:bdt|tk|taka|price|total|cost)\b)/iu.test(text);
    if (orderPriceCue) {
      const expected = input.currentOrderState.total ?? input.currentOrderState.unitPrice;
      const claimed = numbers(text);
      if (expected !== null && expected !== undefined && claimed.length && !claimed.some((value) => sameNumber(value, expected))) return { status: "BLOCKED", reply: safeOrderReply(input.currentOrderState), reason: "Order price conflicts with backend snapshot", liveConfigurationVersion: live.version };
    }
  }
  return { status: "SAFE_TO_SEND", reply: text, liveConfigurationVersion: live.version };
}
