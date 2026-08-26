import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
const infoMock = vi.fn();
const warnMock = vi.fn();

vi.stubGlobal("fetch", fetchMock);
vi.mock("@/services/meta/settings", () => ({
  getMetaPlatformConfig: vi.fn(async () => ({
    appId: "app-id", appSecret: "app-secret", verifyToken: "verify-token", graphApiVersion: "v23.0",
    loginConfigurationId: "login-config", redirectUri: "https://example.test/callback", webhookUrl: "https://example.test/webhook",
  })),
}));
vi.mock("@/services/resilience/retry", () => ({ withProviderCircuit: async (_provider: string, operation: () => Promise<unknown>) => operation() }));
vi.mock("@/lib/logging/logger", () => ({ logger: { info: infoMock, warn: warnMock, error: vi.fn() } }));
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));

function graphResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function graphRequest(index: number) {
  const [input, init] = fetchMock.mock.calls[index] as [URL | string, RequestInit | undefined];
  return {
    url: new URL(input.toString()),
    init: init ?? {},
    headers: new Headers(init?.headers),
    form: new URLSearchParams(typeof init?.body === "string" ? init.body : ""),
  };
}

const validDebug = {
  isValid: true, appId: "app-id", type: "USER", userId: "user-1", expiresAt: null, dataAccessExpiresAt: null,
  scopes: ["pages_show_list", "pages_read_engagement", "pages_manage_metadata", "pages_messaging"], granularScopes: [],
};

beforeEach(() => {
  fetchMock.mockReset();
  infoMock.mockReset();
  warnMock.mockReset();
});

describe("Meta token introspection", () => {
  it("accepts a valid USER token and returns only safe debug fields", async () => {
    fetchMock.mockResolvedValueOnce(graphResponse({ data: { is_valid: true, app_id: "app-id", type: "USER", user_id: "user-1", scopes: ["pages_show_list"], granular_scopes: [{ scope: "pages_show_list", target_ids: ["PAGE_123"] }] } }));
    const { inspectMetaToken } = await import("@/services/meta/service");
    const result = await inspectMetaToken("USER_TOKEN");
    expect(result).toMatchObject({ isValid: true, appId: "app-id", type: "USER", granularScopes: [{ scope: "pages_show_list", targetIds: ["PAGE_123"] }] });
    const request = graphRequest(0);
    expect(request.url.pathname).toBe("/v23.0/debug_token");
    expect(request.url.search).toBe("");
    expect(request.init.method).toBe("POST");
    expect(request.headers.get("authorization")).toBe("Bearer app-id|app-secret");
    expect(request.headers.get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(request.form.get("input_token")).toBe("USER_TOKEN");
    expect(request.form.get("fields")).toContain("granular_scopes");
    expect(JSON.stringify(result)).not.toContain("USER_TOKEN");
    expect(JSON.stringify(result)).not.toContain("app-secret");
  });

  it("exchanges an OAuth code with a POST form and keeps credentials out of the URL", async () => {
    fetchMock.mockResolvedValueOnce(graphResponse({ access_token: "EXCHANGED_USER_TOKEN" }));
    const { exchangeCode } = await import("@/services/meta/service");
    await expect(exchangeCode("OAUTH_CODE", "https://example.test/callback")).resolves.toEqual({ access_token: "EXCHANGED_USER_TOKEN" });
    const request = graphRequest(0);
    expect(request.url.pathname).toBe("/v23.0/oauth/access_token");
    expect(request.url.search).toBe("");
    expect(request.init.method).toBe("POST");
    expect(request.headers.get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(request.form.get("client_id")).toBe("app-id");
    expect(request.form.get("client_secret")).toBe("app-secret");
    expect(request.form.get("redirect_uri")).toBe("https://example.test/callback");
    expect(request.form.get("code")).toBe("OAUTH_CODE");
    expect(request.url.toString()).not.toContain("app-secret");
    expect(request.url.toString()).not.toContain("OAUTH_CODE");
  });

  it("accepts a valid business/system token type", async () => {
    fetchMock.mockResolvedValueOnce(graphResponse({ data: { is_valid: true, app_id: "app-id", type: "SYSTEM_USER", scopes: [] } }));
    const { inspectMetaToken } = await import("@/services/meta/service");
    await expect(inspectMetaToken("SYSTEM_TOKEN")).resolves.toMatchObject({ isValid: true, type: "SYSTEM_USER" });
  });

  it("rejects invalid tokens and tokens from another app", async () => {
    fetchMock.mockResolvedValueOnce(graphResponse({ data: { is_valid: false, app_id: "app-id" } }));
    const { inspectMetaToken, MetaApiError } = await import("@/services/meta/service");
    await expect(inspectMetaToken("INVALID_TOKEN")).rejects.toBeInstanceOf(MetaApiError);
    fetchMock.mockResolvedValueOnce(graphResponse({ data: { is_valid: true, app_id: "wrong-app", type: "USER" } }));
    await expect(inspectMetaToken("WRONG_APP_TOKEN")).rejects.toThrow("different application");
  });
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

  it("discovers a Login for Business Page from granular target IDs when /me/accounts is empty", async () => {
    fetchMock.mockResolvedValueOnce(graphResponse({ data: [] })).mockResolvedValueOnce(graphResponse({ data: [] })).mockResolvedValueOnce(graphResponse({ id: "PAGE_123", name: "Test Facebook Page" }));
    const { discoverPages, pageDiscoveryStatus } = await import("@/services/meta/service");
    const result = await discoverPages("USER_TOKEN", { ...validDebug, granularScopes: [
      { scope: "pages_show_list", targetIds: ["PAGE_123"] }, { scope: "pages_manage_metadata", targetIds: ["PAGE_123"] }, { scope: "pages_messaging", targetIds: ["PAGE_123"] },
    ] });
    expect(result).toEqual([{ id: "PAGE_123", name: "Test Facebook Page" }]);
    expect(pageDiscoveryStatus({ rawRowsReturned: 0, validPageIdentities: 0, displayablePageCount: 1, rowsWithPageAccessToken: 0 })).toBe("PAGES_AVAILABLE");
  });

  it("merges and deduplicates Pages from both sources", async () => {
    fetchMock.mockResolvedValueOnce(graphResponse({ data: [{ id: "PAGE_123", name: "Page A" }, { id: "PAGE_456", name: "Page B" }] })).mockResolvedValueOnce(graphResponse({ data: [] })).mockResolvedValueOnce(graphResponse({ id: "PAGE_123", name: "Page A", access_token: "PAGE_TOKEN" }));
    const { discoverPages } = await import("@/services/meta/service");
    await expect(discoverPages("USER_TOKEN", { ...validDebug, granularScopes: [{ scope: "pages_messaging", targetIds: ["PAGE_123"] }] })).resolves.toEqual([{ id: "PAGE_123", name: "Page A", access_token: "PAGE_TOKEN" }, { id: "PAGE_456", name: "Page B" }]);
  });

  it("excludes a granular target that cannot be verified as a Page", async () => {
    fetchMock.mockResolvedValueOnce(graphResponse({ data: [] })).mockResolvedValueOnce(graphResponse({ error: { message: "Unsupported get request" } }, 400));
    const { discoverPages } = await import("@/services/meta/service");
    await expect(discoverPages("USER_TOKEN", { ...validDebug, granularScopes: [{ scope: "pages_messaging", targetIds: ["NOT_A_PAGE"] }] })).resolves.toEqual([]);
    expect(warnMock).toHaveBeenCalled();
  });

  it("follows pagination and never logs a credential value", async () => {
    fetchMock
      .mockResolvedValueOnce(graphResponse({ data: [{ id: "123", name: "Page A" }], paging: { next: "https://graph.facebook.com/v23.0/me/accounts?after=cursor&access_token=LEAKED_PAGINATION_TOKEN&appsecret_proof=LEAKED_PROOF" } }))
      .mockResolvedValueOnce(graphResponse({ data: [{ id: "456", name: "Page B", access_token: "TOKEN_B" }] }))
      .mockResolvedValueOnce(graphResponse({ data: [] }));
    const { discoverPages } = await import("@/services/meta/service");
    await expect(discoverPages("USER_TOKEN")).resolves.toEqual([{ id: "123", name: "Page A" }, { id: "456", name: "Page B", access_token: "TOKEN_B" }]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (let index = 0; index < fetchMock.mock.calls.length; index += 1) {
      const request = graphRequest(index);
      expect(request.url.searchParams.has("access_token")).toBe(false);
      expect(request.url.searchParams.has("appsecret_proof")).toBe(false);
      expect(request.url.toString()).not.toContain("USER_TOKEN");
      expect(request.url.toString()).not.toContain("LEAKED_PAGINATION_TOKEN");
      expect(request.headers.get("authorization")).toBe("Bearer USER_TOKEN");
    }
    expect(JSON.stringify(infoMock.mock.calls)).not.toContain("TOKEN_B");
    expect(JSON.stringify(infoMock.mock.calls)).not.toContain("USER_TOKEN");
    expect(JSON.stringify(infoMock.mock.calls)).not.toContain("LEAKED_PAGINATION_TOKEN");
  });

  it("resolves a missing Page credential server-side", async () => {
    fetchMock.mockResolvedValueOnce(graphResponse({ id: "123", access_token: "RESOLVED_TOKEN" }));
    const { resolvePageAccessToken } = await import("@/services/meta/service");
    await expect(resolvePageAccessToken("USER_TOKEN", { id: "123", name: "Page A" })).resolves.toBe("RESOLVED_TOKEN");
    const request = graphRequest(0);
    expect(request.url.searchParams.has("access_token")).toBe(false);
    expect(request.url.toString()).not.toContain("USER_TOKEN");
    expect(request.url.toString()).not.toContain("RESOLVED_TOKEN");
    expect(request.headers.get("authorization")).toBe("Bearer USER_TOKEN");
  });

  it("reproduces the production bug and reports a merged Page instead of NO_PAGES", async () => {
    fetchMock
      .mockResolvedValueOnce(graphResponse({ data: { is_valid: true, app_id: "app-id", type: "USER", user_id: "user-1", scopes: validDebug.scopes, granular_scopes: [{ scope: "pages_show_list", target_ids: ["PAGE_123"] }, { scope: "pages_manage_metadata", target_ids: ["PAGE_123"] }, { scope: "pages_messaging", target_ids: ["PAGE_123"] }] } }))
      .mockResolvedValueOnce(graphResponse({ id: "user-1", name: "Admin" }))
      .mockResolvedValueOnce(graphResponse({ data: validDebug.scopes.map((permission) => ({ permission, status: "granted" })) }))
      .mockResolvedValueOnce(graphResponse({ data: [] }))
      .mockResolvedValueOnce(graphResponse({ data: [] }))
      .mockResolvedValueOnce(graphResponse({ id: "PAGE_123", name: "Test Facebook Page" }))
      .mockResolvedValueOnce(graphResponse({ data: [] }));
    const { runPageAccessDiagnostic, pageDiscoveryStatus } = await import("@/services/meta/service");
    const result = await runPageAccessDiagnostic("USER_TOKEN");
    expect(pageDiscoveryStatus(result.diagnostic)).toBe("PAGES_AVAILABLE");
    expect(result.pages).toEqual([{ id: "PAGE_123", name: "Test Facebook Page" }]);
    expect(result.diagnostic.diagnostics).toMatchObject({ granularTargetIds: 1, verifiedGranularPages: 1, finalMergedPages: 1, granularAssetsAuthorized: true });
    expect(JSON.stringify(result)).not.toContain("USER_TOKEN");
  });

  it("uses /me/assigned_pages when /me/accounts is empty", async () => {
    fetchMock
      .mockResolvedValueOnce(graphResponse({ data: [] }))
      .mockResolvedValueOnce(graphResponse({ data: [{ id: "PAGE_123", name: "Karseell Bangladesh", tasks: ["MESSAGING"] }] }));
    const { discoverPages } = await import("@/services/meta/service");
    await expect(discoverPages("USER_TOKEN")).resolves.toEqual([{ id: "PAGE_123", name: "Karseell Bangladesh", tasks: ["MESSAGING"] }]);
  });

  it("resolves a business asset target into assigned Page identities", async () => {
    fetchMock
      .mockResolvedValueOnce(graphResponse({ data: [] }))
      .mockResolvedValueOnce(graphResponse({ data: [] }))
      .mockResolvedValueOnce(graphResponse({ error: { message: "Unsupported get request", code: 100, type: "GraphMethodException", error_subcode: 33 } }, 400))
      .mockResolvedValueOnce(graphResponse({ data: [{ id: "BUSINESS_123", name: "Business Portfolio" }] }))
      .mockResolvedValueOnce(graphResponse({ data: [{ id: "PAGE_123", name: "Karseell Bangladesh", access_token: "PAGE_TOKEN" }] }))
      .mockResolvedValueOnce(graphResponse({ data: [] }))
      .mockResolvedValueOnce(graphResponse({ data: [] }));
    const { discoverPages } = await import("@/services/meta/service");
    await expect(discoverPages("USER_TOKEN", { ...validDebug, scopes: [...validDebug.scopes, "business_management"], granularScopes: [{ scope: "business_management", targetIds: ["BUSINESS_123"] }] })).resolves.toEqual([{ id: "PAGE_123", name: "Karseell Bangladesh", access_token: "PAGE_TOKEN" }]);
    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(graphRequest(2).url.pathname).toBe("/v23.0/BUSINESS_123");
    expect(graphRequest(3).url.pathname).toBe("/v23.0/me/businesses");
    expect(graphRequest(4).url.pathname).toBe("/v23.0/BUSINESS_123/owned_pages");
  });

  it("does not let business_management absence break direct Page discovery", async () => {
    fetchMock
      .mockResolvedValueOnce(graphResponse({ data: { is_valid: true, app_id: "app-id", type: "USER", user_id: "user-1", scopes: validDebug.scopes, granular_scopes: [] } }))
      .mockResolvedValueOnce(graphResponse({ id: "user-1", name: "Owner" }))
      .mockResolvedValueOnce(graphResponse({ data: validDebug.scopes.map((permission) => ({ permission, status: "granted" })) }))
      .mockResolvedValueOnce(graphResponse({ data: [{ id: "PAGE_123", name: "Direct Page" }] }));
    const { runPageAccessDiagnostic } = await import("@/services/meta/service");
    const result = await runPageAccessDiagnostic("USER_TOKEN");
    expect(result.pages).toEqual([{ id: "PAGE_123", name: "Direct Page" }]);
    expect(result.diagnostic.checks.business_management).toMatchObject({ status: "FAIL" });
  });

  it("classifies unresolved granular targets with safe Meta error metadata", async () => {
    fetchMock
      .mockResolvedValueOnce(graphResponse({ data: { is_valid: true, app_id: "app-id", type: "USER", user_id: "user-1", scopes: [...validDebug.scopes, "business_management"], granular_scopes: [{ scope: "pages_show_list", target_ids: ["ASSET_123"] }] } }))
      .mockResolvedValueOnce(graphResponse({ id: "user-1", name: "Admin" }))
      .mockResolvedValueOnce(graphResponse({ data: [...validDebug.scopes, "business_management"].map((permission) => ({ permission, status: "granted" })) }))
      .mockResolvedValueOnce(graphResponse({ data: [] }))
      .mockResolvedValueOnce(graphResponse({ data: [] }))
      .mockResolvedValueOnce(graphResponse({ error: { message: "Unsupported get request", code: 100, type: "GraphMethodException", error_subcode: 33 } }, 400))
      .mockResolvedValueOnce(graphResponse({ data: [] }));
    const { runPageAccessDiagnostic } = await import("@/services/meta/service");
    const result = await runPageAccessDiagnostic("USER_TOKEN");
    expect(result.pages).toEqual([]);
    expect(result.diagnostic.diagnostics.granularTargetDiagnostics).toEqual([expect.objectContaining({ targetId: "ASSET_123", associatedScopes: ["pages_show_list"], verification: "TARGET_UNRESOLVED", metaErrorCode: 100, metaErrorSubcode: 33 })]);
    expect(JSON.stringify(result)).not.toContain("USER_TOKEN");
    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(graphRequest(5).url.pathname).toBe("/v23.0/ASSET_123");
    expect(graphRequest(6).url.pathname).toBe("/v23.0/me/businesses");
  });

  it("retains the first safe Meta error when the identity-only fallback is invalid", async () => {
    fetchMock
      .mockResolvedValueOnce(graphResponse({ data: { is_valid: true, app_id: "app-id", type: "USER", user_id: "user-1", scopes: validDebug.scopes, granular_scopes: [{ scope: "pages_show_list", target_ids: ["PAGE_UNKNOWN"] }] } }))
      .mockResolvedValueOnce(graphResponse({ id: "user-1", name: "Admin" }))
      .mockResolvedValueOnce(graphResponse({ data: validDebug.scopes.map((permission) => ({ permission, status: "granted" })) }))
      .mockResolvedValueOnce(graphResponse({ data: [] }))
      .mockResolvedValueOnce(graphResponse({ data: [] }))
      .mockResolvedValueOnce(graphResponse({ error: { message: "Field access_token is unavailable", code: 100, type: "OAuthException", error_subcode: 999 } }, 400))
      .mockResolvedValueOnce(graphResponse({ id: null, name: null }));
    const { runPageAccessDiagnostic } = await import("@/services/meta/service");
    const result = await runPageAccessDiagnostic("USER_TOKEN");
    expect(result.pages).toEqual([]);
    expect(result.diagnostic.diagnostics.granularTargetDiagnostics).toEqual([expect.objectContaining({ targetId: "PAGE_UNKNOWN", verification: "TARGET_UNRESOLVED", metaErrorCode: 100, metaErrorSubcode: 999, metaErrorType: "OAuthException" })]);
    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(graphRequest(5).url.searchParams.get("fields")).toContain("access_token");
    expect(graphRequest(6).url.searchParams.get("fields")).toBe("id,name,tasks");
  });
});
