import { describe, expect, it } from "vitest";
import { businessSetupSchema, productSchema } from "@/lib/validation/business";

describe("Step 1 validation", () => {
  it("requires meaningful raw business information", () => {
    expect(businessSetupSchema.safeParse({ pageId: "not-a-uuid", rawBusinessInfo: "short" }).success).toBe(false);
  });
  it("accepts a page-scoped product with a variant", () => {
    const result = productSchema.safeParse({ pageId: "00000000-0000-0000-0000-000000000000", name: "Sample", sku: "S-001", price: "12.50" });
    expect(result.success).toBe(true);
  });
});
