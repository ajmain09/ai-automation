import { z } from "zod";
import { normalizePhone } from "@/services/orders/phone";

export const orderStates = ["BROWSING", "INTERESTED", "ORDER_DRAFT", "AWAITING_CONFIRMATION", "CONFIRMED", "UPDATED", "CANCELLED"] as const;
export type OrderState = (typeof orderStates)[number];

export const orderDraftSchema = z.object({
  orderSessionId: z.string().min(1),
  productId: z.string().nullable().default(null),
  productName: z.string().nullable().default(null),
  variantId: z.string().nullable().default(null),
  variantDetails: z.record(z.string(), z.unknown()).nullable().default(null),
  quantity: z.number().int().positive().nullable().default(null),
  unitPrice: z.number().nonnegative().nullable().default(null),
  currency: z.string().max(8).nullable().default(null),
  customerName: z.string().trim().nullable().default(null),
  phone: z.string().trim().nullable().default(null),
  phoneOriginal: z.string().trim().nullable().default(null),
  fullAddress: z.string().trim().nullable().default(null),
  configurationVersion: z.number().int().positive().nullable().default(null),
  state: z.enum(orderStates).default("BROWSING"),
  priceAtDraft: z.number().nonnegative().nullable().default(null),
});
export type OrderDraft = z.infer<typeof orderDraftSchema>;

export type ProductTruth = {
  id: string;
  name: string;
  active: boolean;
  variant: { id: string; sku: string; size?: string | null; color?: string | null; active: boolean; price: number };
};

export function emptyOrderDraft(orderSessionId: string): OrderDraft {
  return orderDraftSchema.parse({ orderSessionId });
}

export function updateOrderDraft(current: unknown, patch: Partial<OrderDraft>, options: { countryCode?: string } = {}) {
  const draft = orderDraftSchema.parse(current);
  const next = orderDraftSchema.parse({ ...draft, ...patch });
  if (patch.phone !== undefined && patch.phone !== null) {
    const normalized = normalizePhone(patch.phone, { countryCode: options.countryCode });
    next.phone = normalized?.normalized ?? patch.phone.trim();
    next.phoneOriginal = normalized?.original ?? patch.phone.trim();
  }
  if (next.state === "BROWSING" && (next.productId || next.productName)) next.state = "INTERESTED";
  if (next.productId || next.customerName || next.phone || next.fullAddress) next.state = "ORDER_DRAFT";
  return next;
}

export function requiredDraftFields(requiredFields: string[]) {
  return requiredFields.filter((field) => ["name", "phone", "address", "product", "variant", "quantity"].includes(field));
}

export function validateOrderDraft(draftInput: unknown, requiredFields: string[], product?: ProductTruth | null, currentConfigurationVersion?: number, countryCode = "US") {
  const draft = orderDraftSchema.parse(draftInput);
  const missing: string[] = [];
  const checks: Record<string, boolean> = {
    name: Boolean(draft.customerName), phone: Boolean(draft.phone), address: Boolean(draft.fullAddress), product: Boolean(draft.productId),
    variant: Boolean(draft.variantId), quantity: Boolean(draft.quantity && draft.quantity > 0),
  };
  for (const field of requiredDraftFields(requiredFields)) if (!checks[field]) missing.push(field);
  if (draft.phone && !normalizePhone(draft.phone, { countryCode })) missing.push("phone");
  if (product && (!product.active || !product.variant.active)) throw new Error("Product or variant is inactive");
  if (product && draft.productId !== product.id) throw new Error("Product does not match the current page catalog");
  if (product && draft.variantId !== product.variant.id) throw new Error("Variant does not match the selected product");
  if (product && draft.priceAtDraft !== null && draft.priceAtDraft !== product.variant.price) return { valid: false, missing, priceChanged: true, draft, currentPrice: product.variant.price };
  if (currentConfigurationVersion !== undefined && draft.configurationVersion !== null && draft.configurationVersion !== currentConfigurationVersion) return { valid: false, missing, configurationChanged: true, draft };
  return { valid: missing.length === 0, missing, priceChanged: false, draft };
}

export function isClearConfirmation(text: string) {
  return /^(yes|y|confirm|confirmed|order\s*(korbo|koren|den)|নিশ্চিত|হ্যাঁ)[.!\s]*$/iu.test(text.trim());
}

export function isAmbiguousConfirmation(text: string) {
  return /^(hmm|dekhi|maybe|mone\s*hocche|perhaps|okay|ok)[.!\s]*$/iu.test(text.trim());
}

export function transitionOrderState(current: OrderState, input: { intent?: string; confirmationText?: string; draftValid?: boolean; cancelled?: boolean; updated?: boolean }): { state: OrderState; clarification?: string } {
  if (current === "CANCELLED") return { state: current };
  if (input.cancelled && current === "CONFIRMED") return { state: "CANCELLED" };
  if (input.updated && current === "CONFIRMED") return { state: "UPDATED" };
  if (current === "CONFIRMED" && !input.updated) return { state: current };
  if (input.confirmationText) {
    if (isClearConfirmation(input.confirmationText) && input.draftValid) return { state: "CONFIRMED" };
    if (isAmbiguousConfirmation(input.confirmationText) || !isClearConfirmation(input.confirmationText)) return { state: "AWAITING_CONFIRMATION", clarification: "Please reply clearly with Yes to confirm, or No to cancel." };
  }
  if (input.draftValid) return { state: "AWAITING_CONFIRMATION" };
  if (input.intent === "interested") return { state: "INTERESTED" };
  if (input.intent === "order") return { state: "ORDER_DRAFT" };
  return { state: current };
}
