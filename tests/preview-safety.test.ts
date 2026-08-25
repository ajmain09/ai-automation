import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  const env = process.env as Record<string, string | undefined>;
  env.NODE_ENV = "development"; env.DEV_PREVIEW = "true"; env.PREVIEW_ADMIN_EMAIL = "admin@local.test"; env.PREVIEW_ADMIN_PASSWORD = "Admin123!"; env.SESSION_SECRET = "local-preview-session-secret-for-safety-tests-123";
  delete env.DATABASE_URL;
  delete (globalThis as typeof globalThis & { __growthifyxPreviewState?: unknown }).__growthifyxPreviewState;
  vi.resetModules();
});

describe("preview stabilization safety boundaries", () => {
  it("uses one Meta catalog and removes a connected candidate", async () => {
    const { createPreviewPage, connectPreviewPage, getPreviewFacebookPages } = await import("@/services/preview/store");
    const page = createPreviewPage("Candidate Page");
    const first = getPreviewFacebookPages()[0];
    expect(first).toBeDefined();
    connectPreviewPage(page.id, first.id);
    expect(getPreviewFacebookPages().some((candidate) => candidate.id === first.id)).toBe(false);
  });

  it("keeps the old AI credential state until a replacement test succeeds", async () => {
    const { testPreviewAiCredential, updatePreviewAiSettings } = await import("@/services/preview/store");
    const pageId = "11111111-1111-4111-8111-111111111113";
    expect(testPreviewAiCredential(pageId, "").ok).toBe(false);
    const saved = updatePreviewAiSettings(pageId, { apiKey: "new-preview-key" });
    expect(saved.apiKeyConfigured).toBe(true);
    expect(testPreviewAiCredential(pageId, "").ok).toBe(true);
  });

  it("stores the FX snapshot on each new usage attempt", async () => {
    const { createPreviewPage, getPreviewUsage, runPreviewAiTest, updatePreviewPageBudget } = await import("@/services/preview/store");
    const pageId = createPreviewPage("FX Snapshot Page").id;
    updatePreviewPageBudget(pageId, { usdBdtRate: 200 });
    runPreviewAiTest(pageId, "What is the price?");
    const first = getPreviewUsage(pageId).month.estimatedCostBdt;
    updatePreviewPageBudget(pageId, { usdBdtRate: 300 });
    runPreviewAiTest(pageId, "What is the price?");
    const second = getPreviewUsage(pageId).month.estimatedCostBdt;
    expect(second / first).toBeCloseTo(2.5, 6);
  });
});
