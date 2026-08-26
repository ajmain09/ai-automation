import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  connectMetaPage, decryptCredential, finalizeOAuthState, healthCheckMetaPage, missingBlockingPagePermissions,
  prisma, requireAdmin, resolvePageAccessToken, runPageAccessDiagnostic,
} = vi.hoisted(() => ({
  connectMetaPage: vi.fn(),
  decryptCredential: vi.fn(() => "USER_TOKEN"),
  finalizeOAuthState: vi.fn(),
  healthCheckMetaPage: vi.fn(),
  missingBlockingPagePermissions: vi.fn(() => []),
  prisma: {
    oAuthState: { findUnique: vi.fn() },
    page: { findUnique: vi.fn(), create: vi.fn() },
    auditLog: { create: vi.fn() },
  },
  requireAdmin: vi.fn(async () => ({ id: "admin-1" })),
  resolvePageAccessToken: vi.fn(async () => "PAGE_TOKEN"),
  runPageAccessDiagnostic: vi.fn(),
}));

class MockMetaApiError extends Error {
  details = { operation: "page.access_token", code: "META_ERROR" };
}

vi.mock("@/lib/auth/session", () => ({ requireAdmin }));
vi.mock("@/lib/auth/csrf", () => ({ isSameOrigin: vi.fn(() => true) }));
vi.mock("@/lib/env", () => ({ isDevPreview: vi.fn(() => false) }));
vi.mock("@/lib/encryption/service", () => ({ decryptCredential }));
vi.mock("@/lib/db/prisma", () => ({ prisma }));
vi.mock("@/services/issues/service", () => ({ upsertActionableIssue: vi.fn() }));
vi.mock("@/lib/logging/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn() }, redactSensitiveText: (value: string) => value }));
vi.mock("@/services/meta/service", () => ({ connectMetaPage, finalizeOAuthState, healthCheckMetaPage, MetaApiError: MockMetaApiError, missingBlockingPagePermissions, resolvePageAccessToken, runPageAccessDiagnostic }));

const granted = [
  { permission: "pages_show_list", status: "granted" }, { permission: "pages_read_engagement", status: "granted" },
  { permission: "pages_manage_metadata", status: "granted" }, { permission: "pages_messaging", status: "granted" },
];
const state = { encryptedUserToken: "encrypted-user-token", consumedAt: null, expiresAt: new Date(Date.now() + 60_000) };

beforeEach(() => {
  vi.resetModules();
  prisma.oAuthState.findUnique.mockReset();
  prisma.page.findUnique.mockReset();
  prisma.page.create.mockReset();
  prisma.auditLog.create.mockReset();
  connectMetaPage.mockReset();
  finalizeOAuthState.mockReset();
  healthCheckMetaPage.mockReset();
  resolvePageAccessToken.mockReset();
  runPageAccessDiagnostic.mockReset();
  runPageAccessDiagnostic.mockResolvedValue({ pages: [{ id: "PAGE_123", name: "Test Page" }], diagnostic: { permissions: granted } });
  resolvePageAccessToken.mockResolvedValue("PAGE_TOKEN");
  healthCheckMetaPage.mockResolvedValue({ id: "PAGE_123", name: "Test Page" });
  connectMetaPage.mockResolvedValue({ id: "workspace-1" });
  prisma.oAuthState.findUnique.mockResolvedValue(state);
  prisma.page.findUnique.mockResolvedValue(null);
  prisma.page.create.mockResolvedValue({ id: "workspace-1" });
});

async function post(body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/meta/connect/route");
  return POST(new Request("http://localhost:3000/api/meta/connect", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }));
}

describe("Meta Page connection flow", () => {
  it("returns OAuth expiration without attempting discovery", async () => {
    prisma.oAuthState.findUnique.mockResolvedValue(null);
    const response = await post({ state: "state-for-connect-test-123", metaPageId: "PAGE_123", name: "Test Page" });
    expect(response.status).toBe(400);
    expect((await response.json()).status).toBe("OAUTH_EXPIRED");
    expect(runPageAccessDiagnostic).not.toHaveBeenCalled();
  });

  it("uses the merged Page list and obtains the Page credential later", async () => {
    const response = await post({ state: "state-for-connect-test-123", metaPageId: "PAGE_123", name: "untrusted browser name" });
    expect(response.status).toBe(200);
    expect(resolvePageAccessToken).toHaveBeenCalledWith("USER_TOKEN", { id: "PAGE_123", name: "Test Page" });
    expect(connectMetaPage).toHaveBeenCalledWith(expect.objectContaining({ pageId: "workspace-1", metaPageId: "PAGE_123", name: "Test Page", pageAccessToken: "PAGE_TOKEN" }));
    expect(JSON.stringify(await response.clone().json())).not.toContain("PAGE_TOKEN");
  });

  it("supports selecting among multiple discovered Pages", async () => {
    runPageAccessDiagnostic.mockResolvedValue({ pages: [{ id: "PAGE_123", name: "Page One" }, { id: "PAGE_456", name: "Page Two" }], diagnostic: { permissions: granted } });
    const response = await post({ state: "state-for-connect-test-123", metaPageId: "PAGE_456", name: "Page Two" });
    expect(response.status).toBe(200);
    expect(resolvePageAccessToken).toHaveBeenCalledWith("USER_TOKEN", { id: "PAGE_456", name: "Page Two" });
  });

  it("returns PAGE_CREDENTIAL_ERROR when credential resolution fails", async () => {
    resolvePageAccessToken.mockRejectedValue(new MockMetaApiError("credential denied"));
    const response = await post({ state: "state-for-connect-test-123", metaPageId: "PAGE_123", name: "Test Page" });
    expect(response.status).toBe(502);
    expect((await response.json()).status).toBe("PAGE_CREDENTIAL_ERROR");
    expect(prisma.page.create).not.toHaveBeenCalled();
  });

  it("reconnects an existing Page without deleting or creating a workspace", async () => {
    const existing = { id: "existing-workspace", slug: "test-page", name: "Test Page" };
    prisma.page.findUnique.mockResolvedValue(existing);
    const response = await post({ state: "state-for-connect-test-123", metaPageId: "PAGE_123", name: "Test Page", refresh: true });
    expect(response.status).toBe(200);
    expect(prisma.page.create).not.toHaveBeenCalled();
    expect(connectMetaPage).toHaveBeenCalledWith(expect.objectContaining({ pageId: "existing-workspace" }));
  });

  it("leaves a new workspace unconnected when webhook subscription/health fails", async () => {
    healthCheckMetaPage.mockRejectedValue(new Error("subscription failed"));
    const response = await post({ state: "state-for-connect-test-123", metaPageId: "PAGE_123", name: "Test Page" });
    expect(response.status).toBe(502);
    expect((await response.json()).status).toBe("META_ERROR");
    expect(finalizeOAuthState).not.toHaveBeenCalled();
  });
});
