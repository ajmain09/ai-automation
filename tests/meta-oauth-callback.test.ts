import { beforeEach, describe, expect, it, vi } from "vitest";

const { consumeOAuthState, exchangeCode, encryptCredential, inspectMetaToken, oauthStateUpdate, requireAdmin } = vi.hoisted(() => ({
  consumeOAuthState: vi.fn(),
  exchangeCode: vi.fn(),
  inspectMetaToken: vi.fn(async () => ({ isValid: true, appId: "app-id", type: "USER", userId: "user-id", expiresAt: null, dataAccessExpiresAt: null, scopes: ["pages_show_list"], granularScopes: [] })),
  encryptCredential: vi.fn((value: string) => `encrypted:${value}`),
  oauthStateUpdate: vi.fn(),
  requireAdmin: vi.fn(async () => ({ id: "admin-1" })),
}));

vi.mock("@/lib/auth/session", () => ({ requireAdmin }));
vi.mock("@/services/meta/service", () => ({ consumeOAuthState, exchangeCode, inspectMetaToken }));
vi.mock("@/lib/encryption/service", () => ({ encryptCredential }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { oAuthState: { update: oauthStateUpdate } } }));

const productionEnv = {
  NODE_ENV: "production",
  DEV_PREVIEW: "false",
  APP_URL: "https://ai.growthifyx.space",
  DATABASE_URL: "postgresql://prod:secret@db.internal:5432/growthifyx?schema=public",
  SESSION_SECRET: "production-session-secret-that-is-long-enough-123",
  APP_ENCRYPTION_KEY: "production-encryption-key-that-is-long-enough-123",
};

beforeEach(() => {
  Object.assign(process.env, productionEnv);
  delete process.env.PREVIEW_ADMIN_EMAIL;
  delete process.env.PREVIEW_ADMIN_PASSWORD;
  consumeOAuthState.mockReset();
  exchangeCode.mockReset();
  inspectMetaToken.mockClear();
  encryptCredential.mockClear();
  oauthStateUpdate.mockReset();
  requireAdmin.mockClear();
  vi.resetModules();
});

describe("Meta OAuth callback redirects", () => {
  it("uses APP_URL in production, never the internal localhost origin, and preserves state", async () => {
    const state = "state/with?reserved=chars&unicode=✓";
    consumeOAuthState.mockResolvedValue({ redirectUri: "https://ai.growthifyx.space/api/meta/oauth/callback" });
    exchangeCode.mockResolvedValue({ access_token: "user-token" });
    oauthStateUpdate.mockResolvedValue({});

    const { GET } = await import("@/app/api/meta/oauth/callback/route");
    const requestUrl = `http://localhost:3000/api/meta/oauth/callback?state=${encodeURIComponent(state)}&code=oauth-code`;
    const response = await GET(new Request(requestUrl));
    const location = response.headers.get("location");

    expect(location).toBeTruthy();
    expect(location).not.toContain("localhost");
    expect(new URL(location!).origin).toBe("https://ai.growthifyx.space");
    expect(new URL(location!).pathname).toBe("/pages/new");
    expect(new URL(location!).searchParams.get("meta_state")).toBe(state);
  });

  it("keeps development preview callback behavior local", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    process.env.DEV_PREVIEW = "true";
    process.env.PREVIEW_ADMIN_EMAIL = "admin@local.test";
    process.env.PREVIEW_ADMIN_PASSWORD = "Admin123!";
    process.env.SESSION_SECRET = "local-preview-session-secret-for-oauth-tests-123";

    const { GET } = await import("@/app/api/meta/oauth/callback/route");
    const response = await GET(new Request("http://localhost:3000/api/meta/oauth/callback"));

    expect(response.headers.get("location")).toBe("http://localhost:3000/pages/new?preview=connected");
    expect(requireAdmin).not.toHaveBeenCalled();
    expect(consumeOAuthState).not.toHaveBeenCalled();
  });

  it("stores the exchanged user access token encrypted", async () => {
    const state = "state-for-encrypted-token-test";
    consumeOAuthState.mockResolvedValue({ redirectUri: "https://ai.growthifyx.space/api/meta/oauth/callback" });
    exchangeCode.mockResolvedValue({ access_token: "user-token" });
    oauthStateUpdate.mockResolvedValue({});

    const { GET } = await import("@/app/api/meta/oauth/callback/route");
    await GET(new Request(`http://localhost:3000/api/meta/oauth/callback?state=${state}&code=oauth-code`));

    expect(encryptCredential).toHaveBeenCalledWith("user-token");
    expect(inspectMetaToken).toHaveBeenCalledWith("user-token");
    expect(oauthStateUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { stateHash: expect.any(String) },
      data: expect.objectContaining({ encryptedUserToken: "encrypted:user-token", permissionDiagnostics: expect.objectContaining({ tokenType: "USER" }) }),
    }));
  });

  it("rejects an invalid or wrong-app token before storing any credential", async () => {
    consumeOAuthState.mockResolvedValue({ redirectUri: "https://ai.growthifyx.space/api/meta/oauth/callback" });
    exchangeCode.mockResolvedValue({ access_token: "user-token" });
    inspectMetaToken.mockRejectedValue(new Error("invalid token"));

    const { GET } = await import("@/app/api/meta/oauth/callback/route");
    const response = await GET(new Request("http://localhost:3000/api/meta/oauth/callback?state=state-invalid-token&code=oauth-code"));

    expect(response.status).toBe(400);
    expect(encryptCredential).not.toHaveBeenCalled();
    expect(oauthStateUpdate).not.toHaveBeenCalled();
  });
});
