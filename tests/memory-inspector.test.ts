import { beforeEach, describe, expect, it } from "vitest";

const pageA = "11111111-1111-4111-8111-111111111111";
const pageB = "11111111-1111-4111-8111-111111111112";
const customerA = "44444444-4444-4444-8444-444444444441";

beforeEach(() => {
  const env = process.env as Record<string, string | undefined>;
  env.NODE_ENV = "development"; env.DEV_PREVIEW = "true"; env.PREVIEW_ADMIN_EMAIL = "admin@local.test"; env.PREVIEW_ADMIN_PASSWORD = "Admin123!"; env.SESSION_SECRET = "local-preview-session-secret-for-memory-tests-123";
  delete (globalThis as typeof globalThis & { __growthifyxPreviewState?: unknown }).__growthifyxPreviewState;
});

describe("preview memory inspector mutations", () => {
  it("edits and supersedes a fact without losing history", async () => {
    const { getPreviewCustomerMemory, editPreviewCustomerFact } = await import("@/services/preview/store");
    editPreviewCustomerFact({ pageId: pageA, customerId: customerA, factKey: "name", value: "Maya Corrected" });
    const result = getPreviewCustomerMemory(pageA, customerA);
    expect(result.memory.knownFacts.name).toBe("Maya Corrected");
    expect(result.facts.some((fact) => fact.status === "SUPERSEDED" && fact.factKey === "name")).toBe(true);
    expect(result.facts.some((fact) => fact.status === "ACTIVE" && fact.displayValue === "Maya Corrected")).toBe(true);
  });

  it("supports mark unknown, remove, summary rebuild, and non-order clear", async () => {
    const { clearPreviewNonOrderMemory, getPreviewCustomerMemory, markPreviewCustomerFactUnknown, rebuildPreviewCustomerSummary, removePreviewCustomerFact } = await import("@/services/preview/store");
    markPreviewCustomerFactUnknown({ pageId: pageA, customerId: customerA, factKey: "name" });
    let result = getPreviewCustomerMemory(pageA, customerA);
    expect(result.memory.knownFacts.name).toBeUndefined();
    expect(result.facts.some((fact) => fact.factKey === "name" && fact.status === "REJECTED")).toBe(true);
    removePreviewCustomerFact({ pageId: pageA, customerId: customerA, factKey: "name" });
    clearPreviewNonOrderMemory({ pageId: pageA, customerId: customerA });
    result = getPreviewCustomerMemory(pageA, customerA);
    expect(result.memory.activeOrderReference).toBeTruthy();
    expect(result.memory.needs).toEqual([]);
    rebuildPreviewCustomerSummary({ pageId: pageA, customerId: customerA });
    result = getPreviewCustomerMemory(pageA, customerA);
    expect(result.summaryStale).toBe(false);
    expect(result.memory.summary).toContain("Known facts:");
  });

  it("keeps mutations Page isolated and preserves order history", async () => {
    const { clearPreviewNonOrderMemory, getPreviewCustomerMemory, getPreviewOrders } = await import("@/services/preview/store");
    const before = getPreviewCustomerMemory(pageB, "44444444-4444-4444-8444-444444444442");
    clearPreviewNonOrderMemory({ pageId: pageA, customerId: customerA });
    const after = getPreviewCustomerMemory(pageB, "44444444-4444-4444-8444-444444444442");
    expect(after.memory.needs).toEqual(before.memory.needs);
    expect(getPreviewOrders(pageA)).toHaveLength(1);
  });

  it("supports idempotent preview data deletion while preserving anonymized orders", async () => {
    const { deletePreviewCustomerData, getPreviewCustomers, getPreviewOrders } = await import("@/services/preview/store");
    const first = deletePreviewCustomerData({ pageId: pageA, customerId: customerA, requestKey: "preview-delete-001" });
    const second = deletePreviewCustomerData({ pageId: pageA, customerId: customerA, requestKey: "preview-delete-001" });
    expect(first.alreadyCompleted).toBe(false);
    expect(second.alreadyCompleted).toBe(true);
    expect(getPreviewCustomers(pageA)).toHaveLength(0);
    expect(getPreviewOrders(pageA)[0].customerName).toBe("Deleted customer");
  });
});
