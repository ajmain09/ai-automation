import { describe, expect, it } from "vitest";
import { anonymizeOrderPayload, deletionRequestSchema } from "@/services/data-deletion/service";

describe("data deletion safety primitives", () => {
  it("validates scoped idempotent requests", () => {
    expect(deletionRequestSchema.safeParse({ pageId: "not-a-uuid", customerId: "not-a-uuid", requestKey: "x" }).success).toBe(false);
    expect(deletionRequestSchema.safeParse({ pageId: "11111111-1111-4111-8111-111111111111", customerId: "44444444-4444-4444-8444-444444444441", requestKey: "meta-delete-001" }).success).toBe(true);
  });

  it("anonymizes personal order fields without dropping preserved business history", () => {
    const payload = anonymizeOrderPayload({ customer_name: "Maya", phone: "+1555", line_items: [{ sku: "OIL-100", quantity: 2 }], total: 20 });
    expect(payload).toEqual({ customer_name: "[REMOVED]", phone: "[REMOVED]", line_items: [{ sku: "OIL-100", quantity: 2 }], total: 20 });
  });
});
