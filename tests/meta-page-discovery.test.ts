import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
const infoMock = vi.fn();

vi.stubGlobal("fetch", fetchMock);
vi.mock("@/services/meta/settings", () => ({
  getMetaPlatformConfig: vi.fn(async () => ({
    appId: "app-id",
    appSecret: "app-secret",
    verifyToken: "verify-token",
    graphApiVersion: "v23.0",
    loginConfigurationId: "login-config",
    redirectUri: "https://example.test/callback",
    webhookUrl: "https://example.test/webhook",
  })),
}));
vi.mock("@/services/resilience/retry", () => ({ withProviderCircuit: async (_provider: string, operation: () => Promise<unknown>) => operation() }));
vi.mock("@/lib/logging/logger", () => ({ logger: { info: infoMock, warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));

function graphResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  fetchMock.mockReset();
  infoMock.mockReset();
});

describe("Meta Page discovery", () => {
  it("returns a Page with an inline Page credential", async () => {
    fetchMock.mockResolvedValueOnce(graphResponse({ data: [{ id: "123", name: "Page A", access_token: "TOKEN" }] }));

    const { discoverPages } = await import("@/services/meta/service");
    await expect(discoverPages("USER_TOKEN")).resolves.toEqual([{ id: "123", name: "Page A", access_token: "TOKEN" }]);
  });

  it("keeps a valid Page identity when Meta omits the inline credential", async () => {
    fetchMock.mockResolvedValueOnce(graphResponse({ data: [{ id: "123", name: "Page A", tasks: ["MESSAGING"] }] }));

    const { discoverPages } = await import("@/services/meta/service");
    await expect(discoverPages("USER_TOKEN")).resolves.toEqual([{ id: "123", name: "Page A", tasks: ["MESSAGING"] }]);
  });

  it("returns no Pages only when Meta returns no valid Page identities", async () => {
    fetchMock.mockResolvedValueOnce(graphResponse({ data: [] }));

    const { discoverPages, pageDiscoveryStatus } = await import("@/services/meta/service");
    await expect(discoverPages("USER_TOKEN")).resolves.toEqual([]);
    expect(pageDiscoveryStatus({ rawRowsReturned: 0, validPageIdentities: 0, displayablePageCount: 0, rowsWithPageAccessToken: 0 })).toBe("NO_PAGES");
  });

  it("returns all valid identities when token availability is mixed", async () => {
    fetchMock.mockResolvedValueOnce(graphResponse({ data: [
      { id: "123", name: "Page A", access_token: "TOKEN_A" },
      { id: "456", name: "Page B" },
    ] }));

    const { discoverPages } = await import("@/services/meta/service");
    await expect(discoverPages("USER_TOKEN")).resolves.toEqual([
      { id: "123", name: "Page A", access_token: "TOKEN_A" },
      { id: "456", name: "Page B" },
    ]);
  });

  it("follows Meta pagination and never logs a credential value", async () => {
    fetchMock
      .mockResolvedValueOnce(graphResponse({ data: [{ id: "123", name: "Page A" }], paging: { next: "https://graph.facebook.com/v23.0/me/accounts?after=cursor" } }))
      .mockResolvedValueOnce(graphResponse({ data: [{ id: "456", name: "Page B", access_token: "TOKEN_B" }] }));

    const { discoverPages } = await import("@/services/meta/service");
    await expect(discoverPages("USER_TOKEN")).resolves.toEqual([
      { id: "123", name: "Page A" },
      { id: "456", name: "Page B", access_token: "TOKEN_B" },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(infoMock.mock.calls)).not.toContain("TOKEN_B");
    expect(JSON.stringify(infoMock.mock.calls)).not.toContain("USER_TOKEN");
  });

  it("resolves a missing Page credential server-side", async () => {
    fetchMock.mockResolvedValueOnce(graphResponse({ id: "123", access_token: "RESOLVED_TOKEN" }));

    const { resolvePageAccessToken } = await import("@/services/meta/service");
    await expect(resolvePageAccessToken("USER_TOKEN", { id: "123", name: "Page A" })).resolves.toBe("RESOLVED_TOKEN");
    expect(fetchMock.mock.calls[0][0].toString()).not.toContain("RESOLVED_TOKEN");
  });

  it("reports raw and identity counts without exposing credentials in diagnostics", async () => {
    fetchMock
      .mockResolvedValueOnce(graphResponse({ id: "user-1", name: "Admin" }))
      .mockResolvedValueOnce(graphResponse({ data: [
        { permission: "pages_show_list", status: "granted" },
        { permission: "pages_read_engagement", status: "granted" },
        { permission: "pages_manage_metadata", status: "granted" },
        { permission: "pages_messaging", status: "granted" },
      ] }))
      .mockResolvedValueOnce(graphResponse({ data: [{ id: "123", name: "Page A" }] }))
      .mockResolvedValueOnce(graphResponse({ data: [] }));

    const { pageDiscoveryStatus, runPageAccessDiagnostic } = await import("@/services/meta/service");
    const result = await runPageAccessDiagnostic("USER_TOKEN");
    expect(result.diagnostic).toMatchObject({ rawRowsReturned: 1, validPageIdentities: 1, displayablePageCount: 1, rowsWithPageAccessToken: 0 });
    expect(pageDiscoveryStatus(result.diagnostic)).toBe("PAGE_FOUND_TOKEN_PENDING");
    expect(JSON.stringify(result.diagnostic)).not.toContain("USER_TOKEN");
    expect(new URL(fetchMock.mock.calls[2][0].toString()).searchParams.get("fields")).toBe("id,name,tasks,access_token");
  });
});
