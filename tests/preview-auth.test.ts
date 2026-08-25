import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cookieJar, prismaAccess } = vi.hoisted(() => ({
  cookieJar: new Map<string, string>(),
  prismaAccess: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => {
      const value = cookieJar.get(name);
      return value ? { value } : undefined;
    },
    set: (name: string, value: string) => cookieJar.set(name, value),
    delete: (name: string) => cookieJar.delete(name),
  })),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: new Proxy({}, { get() { prismaAccess(); throw new Error("Preview authentication accessed Prisma"); } }),
}));

const ENV_KEYS = ["NODE_ENV", "DEV_PREVIEW", "PREVIEW_ADMIN_EMAIL", "PREVIEW_ADMIN_PASSWORD", "SESSION_SECRET", "DATABASE_URL", "APP_URL", "APP_ENCRYPTION_KEY", "ADMIN_EMAIL", "ADMIN_PASSWORD", "META_APP_ID", "META_APP_SECRET", "META_VERIFY_TOKEN", "META_REDIRECT_URI", "META_WEBHOOK_URL"];
const originalEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
const setProcessEnv = (key: string, value: string) => { (process.env as Record<string, string | undefined>)[key] = value; };

beforeEach(() => {
  setProcessEnv("NODE_ENV", "development");
  process.env.DEV_PREVIEW = "true";
  process.env.PREVIEW_ADMIN_EMAIL = "admin@local.test";
  process.env.PREVIEW_ADMIN_PASSWORD = "Admin123!";
  process.env.SESSION_SECRET = "local-preview-session-secret-for-tests-123";
  delete process.env.DATABASE_URL;
  cookieJar.clear();
  prismaAccess.mockClear();
  vi.resetModules();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("development preview authentication", () => {
  it("accepts the development-only default credentials", async () => {
    const { authenticateAdmin } = await import("@/lib/auth/session");
    const admin = await authenticateAdmin("admin@local.test", "Admin123!");
    expect(admin?.email).toBe("admin@local.test");
    expect(prismaAccess).not.toHaveBeenCalled();
  });

  it("reads configured preview credentials and rejects wrong credentials", async () => {
    process.env.PREVIEW_ADMIN_EMAIL = "preview@example.test";
    process.env.PREVIEW_ADMIN_PASSWORD = "Configured123!";
    const { authenticateAdmin } = await import("@/lib/auth/session");
    await expect(authenticateAdmin("admin@local.test", "Admin123!")).resolves.toBeNull();
    await expect(authenticateAdmin("preview@example.test", "Configured123!")).resolves.toMatchObject({ email: "preview@example.test" });
    expect(prismaAccess).not.toHaveBeenCalled();
  });

  it("creates the application session and allows protected dashboard access", async () => {
    const { POST } = await import("@/app/api/auth/login/route");
    const request = new Request("http://localhost:3000/api/auth/login", { method: "POST", body: new URLSearchParams({ email: "admin@local.test", password: "Admin123!" }) });
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(cookieJar.get("gx_session")).toMatch(/^[0-9a-f-]+\.[0-9a-f-]+\.\d+\.[A-Za-z0-9_-]+$/);

    const { requireAdmin } = await import("@/lib/auth/session");
    await expect(requireAdmin()).resolves.toMatchObject({ id: "00000000-0000-4000-8000-000000000001", email: "admin@local.test" });
    expect(prismaAccess).not.toHaveBeenCalled();
  });
});

describe("production preview guard", () => {
  it("rejects DEV_PREVIEW=true in production before authentication can run", async () => {
    setProcessEnv("NODE_ENV", "production");
    process.env.DEV_PREVIEW = "true";
    const { getEnv } = await import("@/lib/env");
    expect(() => getEnv()).toThrow(/DEV_PREVIEW/);
    expect(prismaAccess).not.toHaveBeenCalled();
  });

  it("rejects local preview credentials in an otherwise configured production environment", async () => {
    setProcessEnv("NODE_ENV", "production");
    process.env.DEV_PREVIEW = "false";
    process.env.APP_URL = "https://ai.growthifyx.space";
    process.env.DATABASE_URL = "postgresql://prod:secret@db.internal:5432/growthifyx?schema=public";
    process.env.SESSION_SECRET = "production-session-secret-that-is-long-enough-123";
    process.env.APP_ENCRYPTION_KEY = "production-encryption-key-that-is-long-enough-123";
    process.env.ADMIN_EMAIL = "admin@local.test";
    process.env.ADMIN_PASSWORD = "Admin123!";
    process.env.META_APP_ID = "real-app-id";
    process.env.META_APP_SECRET = "real-app-secret";
    process.env.META_VERIFY_TOKEN = "real-production-verify-token";
    process.env.META_REDIRECT_URI = "https://ai.growthifyx.space/api/meta/oauth/callback";
    process.env.META_WEBHOOK_URL = "https://ai.growthifyx.space/api/meta/webhook";
    const { getEnv } = await import("@/lib/env");
    expect(() => getEnv()).toThrow(/preview credentials/i);
  });

  it("fails clearly when required production values are missing", async () => {
    setProcessEnv("NODE_ENV", "production");
    process.env.DEV_PREVIEW = "false";
    delete process.env.DATABASE_URL;
    delete process.env.SESSION_SECRET;
    delete process.env.APP_ENCRYPTION_KEY;
    const { getEnv } = await import("@/lib/env");
    expect(() => getEnv()).toThrow(/DATABASE_URL/);
  });
});
