import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  configurationVersion: { findFirst: vi.fn() },
  product: { findMany: vi.fn() },
  businessProfile: { findUnique: vi.fn() },
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: db }));

const pageA = "page-a";
const pageB = "page-b";
const productId = "product-a";

function truth(variantOverrides: Record<string, unknown> = {}, productOverrides: Record<string, unknown> = {}) {
  return {
    id: productId,
    pageId: pageA,
    name: "Silk Serum",
    active: true,
    ...productOverrides,
    variants: [{ id: "variant-a", sku: "SERUM-M", size: "M", color: "Black", currentPrice: 100, oldPrice: 120, stockStatus: "IN_STOCK", active: true, ...variantOverrides }],
  };
}

async function guard(reply: string, options: Record<string, unknown> = {}) {
  const { validateAndCorrectCommercialReply } = await import("@/services/messaging/commercial-guard");
  return validateAndCorrectCommercialReply({ pageId: pageA, generatedReply: reply, generatedConfigurationVersion: 1, ...options });
}

describe("commercial reply truth guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.configurationVersion.findFirst.mockResolvedValue({ version: 1, businessData: { policies: { cod: "Cash on delivery is available.", delivery: "Delivery in 3-5 business days." }, unknown_information: [] } });
    db.businessProfile.findUnique.mockResolvedValue({ deliveryPolicy: "Delivery in 3-5 business days.", codPolicy: "Cash on delivery is available.", policies: {} });
    db.product.findMany.mockResolvedValue([truth()]);
  });

  it("passes a correct commercial response unchanged", async () => {
    const result = await guard("Silk Serum costs BDT 100 and is in stock.", { recommendedProductIds: [productId] });
    expect(result.status).toBe("SAFE_TO_SEND");
    expect(result.reply).toBe("Silk Serum costs BDT 100 and is in stock.");
  });

  it("corrects a wrong current price", async () => {
    const result = await guard("Silk Serum costs BDT 90.", { recommendedProductIds: [productId] });
    expect(result.status).toBe("CORRECTED");
    expect(result.reply).toContain("100");
  });

  it("blocks an old price after an admin price change", async () => {
    db.product.findMany.mockResolvedValue([truth({ oldPrice: 110 })]);
    const result = await guard("Silk Serum was BDT 120 and now costs BDT 100.", { recommendedProductIds: [productId] });
    expect(result.status).toBe("BLOCKED");
  });

  it("blocks inactive products and variants", async () => {
    db.product.findMany.mockResolvedValue([truth({}, { active: false })]);
    expect((await guard("Silk Serum costs BDT 100.", { recommendedProductIds: [productId] })).status).toBe("BLOCKED");
    db.product.findMany.mockResolvedValue([truth({ active: false })]);
    expect((await guard("Silk Serum size L.", { recommendedProductIds: [productId] })).status).toBe("BLOCKED");
  });

  it("blocks a wrong size or variant claim", async () => {
    const result = await guard("Silk Serum, size L, SKU SERUM-M.", { recommendedProductIds: [productId] });
    expect(result.status).toBe("BLOCKED");
  });

  it("rejects invented or unknown policies", async () => {
    expect((await guard("COD is not available.")).status).toBe("BLOCKED");
    db.configurationVersion.findFirst.mockResolvedValue({ version: 1, businessData: { policies: {}, unknown_information: ["return policy", "delivery time"] } });
    db.businessProfile.findUnique.mockResolvedValue({ deliveryPolicy: null, codPolicy: null, policies: {} });
    expect((await guard("We offer free returns and delivery in 1 day.")).status).toBe("BLOCKED");
  });

  it("detects stale LIVE configuration", async () => {
    db.configurationVersion.findFirst.mockResolvedValue({ version: 2, businessData: { policies: {}, unknown_information: [] } });
    const result = await guard("Thanks for your message.");
    expect(result.status).toBe("REGENERATE");
  });

  it("keeps Page A truth out of Page B", async () => {
    db.product.findMany.mockImplementation(async ({ where }: { where: { pageId: string } }) => where.pageId === pageB ? [] : [truth()]);
    const { validateAndCorrectCommercialReply } = await import("@/services/messaging/commercial-guard");
    const result = await validateAndCorrectCommercialReply({ pageId: pageB, generatedReply: "Silk Serum costs BDT 100.", recommendedProductIds: [productId], generatedConfigurationVersion: 1 });
    expect(result.status).toBe("BLOCKED");
    expect(db.product.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { pageId: pageB } }));
  });

  it("validates order confirmation against backend snapshot", async () => {
    const result = await guard("Your order is confirmed. Order reference: order-1. Product: Silk Serum. Variant: SERUM-M / M / Black. Quantity: 2. Unit price: BDT 100. Total: BDT 200.", {
      currentOrderState: { reference: "order-1", status: "CONFIRMED", productName: "Silk Serum", variantDetails: { sku: "SERUM-M", size: "M", color: "Black" }, unitPrice: 100, total: 200, quantity: 2, currency: "BDT" },
    });
    expect(result.status).toBe("SAFE_TO_SEND");
    const wrong = await guard("Your order is confirmed. Order reference: order-1. Product: Silk Serum. Quantity: 2. Unit price: BDT 90. Total: BDT 180.", {
      currentOrderState: { reference: "order-1", status: "CONFIRMED", productName: "Silk Serum", unitPrice: 100, total: 200, quantity: 2 },
    });
    expect(wrong.status).toBe("BLOCKED");
  });
});
