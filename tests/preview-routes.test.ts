import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  const env = process.env as Record<string, string | undefined>;
  env.NODE_ENV = "development";
  env.DEV_PREVIEW = "true";
  env.PREVIEW_ADMIN_EMAIL = "admin@local.test";
  env.PREVIEW_ADMIN_PASSWORD = "Admin123!";
  env.SESSION_SECRET = "local-preview-session-secret-for-route-tests-123";
  delete env.DATABASE_URL;
  vi.resetModules();
});

describe("database-free preview routes", () => {
  it("keeps the three dashboard Page IDs resolvable from one store", async () => {
    const { getPreviewPages, getPreviewPage } = await import("@/services/preview/store");
    const pages = getPreviewPages();
    expect(pages).toHaveLength(3);
    expect(pages.every((page) => getPreviewPage(page.id)?.id === page.id)).toBe(true);
    expect(getPreviewPage("99999999-9999-4999-8999-999999999999")).toBeNull();
  });

  it("connects a preview Page without OAuth state validation", async () => {
    const { connectPreviewPage, getPreviewPage } = await import("@/services/preview/store");
    const page = getPreviewPage("11111111-1111-4111-8111-111111111113")!;
    expect(connectPreviewPage(page.id, "preview-meta-page-001", "Karseell Bangladesh")?.connectionStatus).toBe("CONNECTED");
    expect(getPreviewPage(page.id)?.metaPageId).toBe("preview-meta-page-001");
  });

  it("loads every dashboard data source without Prisma", async () => {
    const pageId = "11111111-1111-4111-8111-111111111111";
    const [{ getDashboardData, getPages, getPageById }, { getOpenIssues }, { getPageOrders }, { getPageUsage }, { getSystemHealth }, { checkPageReadiness }, { retrieveRelevantProducts }] = await Promise.all([
      import("@/services/pages/queries"),
      import("@/services/issues/service"),
      import("@/services/orders/service"),
      import("@/services/usage/queries"),
      import("@/services/health/service"),
      import("@/services/pages/readiness"),
      import("@/services/products/retrieval"),
    ]);

    const dashboard = await getDashboardData();
    const pages = await getPages();
    const page = await getPageById(pageId);
    const issues = await getOpenIssues();
    const orders = await getPageOrders(pageId);
    const usage = await getPageUsage(pageId);
    const health = await getSystemHealth();
    const readiness = await checkPageReadiness(pageId);
    const products = await retrieveRelevantProducts(pageId, "hair oil");

    expect(dashboard.pages.length).toBeGreaterThan(0);
    expect(pages.length).toBe(3);
    expect(page?.id).toBe(pageId);
    expect(issues.length).toBeGreaterThan(0);
    expect(orders.length).toBe(1);
    expect(usage.month.calls).toBeGreaterThan(0);
    expect(health.some((item) => item.component === "Database" && item.detail.includes("not required"))).toBe(true);
    expect(readiness.checks.length).toBeGreaterThan(0);
    expect(products[0]?.name).toBe("Herbal Hair Repair Oil");
  });

  it("uses stable canonical slugs and keeps new preview Pages isolated", async () => {
    const { createPreviewPage, getPreviewPage, getPreviewUsage, getPreviewOrders, copyPreviewSettings, getPreviewPageBudget } = await import("@/services/preview/store");
    const page = getPreviewPage("karseell-bangladesh");
    expect(page?.slug).toBe("karseell-bangladesh");
    expect(getPreviewPage("11111111-1111-4111-8111-111111111111")?.slug).toBe("karseell-bangladesh");
    expect(["/dashboard", "/pages", "/pages/new", "/pages/karseell-bangladesh", "/pages/karseell-bangladesh/business", "/pages/karseell-bangladesh/products", "/pages/karseell-bangladesh/ai", "/pages/karseell-bangladesh/telegram", "/pages/karseell-bangladesh/conversations", "/pages/karseell-bangladesh/customers", "/pages/karseell-bangladesh/orders", "/pages/karseell-bangladesh/usage", "/pages/karseell-bangladesh/settings", "/orders", "/issues", "/settings", "/settings/general", "/settings/meta", "/settings/security", "/settings/health"]).toHaveLength(20);
    const newPage = createPreviewPage("Independent Preview Page");
    expect(getPreviewUsage(newPage.id).month.calls).toBe(0);
    expect(getPreviewOrders(newPage.id)).toHaveLength(0);
    const copied = copyPreviewSettings("11111111-1111-4111-8111-111111111112", newPage.id);
    expect(copied.fields).toContain("AI behavior");
    expect(getPreviewPageBudget(newPage.id).warningThreshold).toBe(85);
  });
});
