import { describe, expect, it } from "vitest";
import { normalizePhone } from "@/services/orders/phone";
import { emptyOrderDraft, isAmbiguousConfirmation, isClearConfirmation, transitionOrderState, updateOrderDraft, validateOrderDraft } from "@/services/orders/engine";
import { backoffWithJitter, CircuitBreaker, classifyFailure } from "@/services/resilience/retry";
import { formatOrderEvent } from "@/services/telegram/service";

describe("Step 3 order engine", () => {
  it("normalizes Bangladesh local and international formats consistently", () => {
    const expected = "+8801712345678";
    expect(normalizePhone("01712345678", { countryCode: "BD" })?.normalized).toBe(expected);
    expect(normalizePhone("+8801712345678", { countryCode: "BD" })?.normalized).toBe(expected);
    expect(normalizePhone("8801712345678", { countryCode: "BD" })?.normalized).toBe(expected);
  });

  it("updates one draft and rejects an invalid or changed price", () => {
    let draft = emptyOrderDraft("session-1");
    draft = updateOrderDraft(draft, { productId: "p1", productName: "Oil", variantId: "v1", quantity: 2, phone: "01712345678" }, { countryCode: "BD" });
    expect(draft.phone).toBe("+8801712345678");
    const result = validateOrderDraft(draft, ["phone", "product", "variant", "quantity"], { id: "p1", name: "Oil", active: true, variant: { id: "v1", sku: "x", active: true, price: 11 } }, undefined, "BD");
    expect(result.priceChanged).toBe(false);
    expect(validateOrderDraft({ ...draft, priceAtDraft: 10 }, ["phone"], { id: "p1", name: "Oil", active: true, variant: { id: "v1", sku: "x", active: true, price: 11 } }, undefined, "BD").priceChanged).toBe(true);
  });

  it("requires explicit confirmation and never treats ambiguous language as confirmation", () => {
    expect(isClearConfirmation("yes")).toBe(true);
    expect(isAmbiguousConfirmation("maybe")).toBe(true);
    expect(transitionOrderState("AWAITING_CONFIRMATION", { confirmationText: "maybe", draftValid: true }).state).toBe("AWAITING_CONFIRMATION");
    expect(transitionOrderState("AWAITING_CONFIRMATION", { confirmationText: "yes", draftValid: true }).state).toBe("CONFIRMED");
    expect(transitionOrderState("CONFIRMED", { cancelled: true }).state).toBe("CANCELLED");
  });
});

describe("Step 3 delivery resilience", () => {
  it("classifies only transient provider failures for retry", () => {
    expect(classifyFailure(new Error("HTTP 503 timeout"))).toBe("TRANSIENT");
    expect(classifyFailure(new Error("permission denied"))).toBe("PERMANENT");
    expect(backoffWithJitter(3, () => 0.5)).toBe(4000);
  });

  it("opens, cools down, probes, and recovers a circuit", () => {
    const breaker = new CircuitBreaker(2, 100);
    breaker.failure(0); breaker.failure(1);
    expect(breaker.status).toBe("OPEN");
    expect(breaker.canCall(50)).toBe(false);
    expect(breaker.canCall(101)).toBe(true);
    breaker.success();
    expect(breaker.status).toBe("CLOSED");
  });

  it("keeps Telegram messages free of internal AI or memory data", () => {
    const message = formatOrderEvent("NEW_ORDER", { page_name: "Demo", customer_name: "A", normalized_phone: "+1", full_address: "Street", product_display_name: "Oil", variant_details: { sku: "SKU", size: "100ml" }, quantity: 1, unit_price: 20, currency: "USD", internal_memory: "secret" });
    expect(message).toContain("NEW ORDER");
    expect(message).not.toContain("internal_memory");
    expect(message).not.toContain("secret");
  });
});
