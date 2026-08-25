import crypto from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { decryptCredential, encryptCredential } from "@/lib/encryption/service";
import { withProviderCircuit } from "@/services/resilience/retry";
import { getMetaPlatformConfig, type MetaPlatformConfig } from "@/services/meta/settings";

export const REQUIRED_META_PERMISSIONS = ["pages_show_list", "pages_read_engagement", "pages_manage_metadata", "pages_messaging"] as const;
export type MetaPermissionStatus = "granted" | "declined" | "expired" | "missing" | "unknown";
export type MetaPermissionDiagnostic = { permission: string; status: MetaPermissionStatus };
export type MetaPage = { id: string; name: string; access_token: string };

export class MetaApiError extends Error {
  constructor(message: string, readonly details: { code?: string | number; type?: string; subcode?: string | number; operation: string }) {
    super(message);
    this.name = "MetaApiError";
  }
}

export class DuplicateMetaPageError extends Error {
  constructor(readonly pageId: string, readonly slug: string, readonly name: string) {
    super("That Facebook Page is already connected.");
    this.name = "DuplicateMetaPageError";
  }
}

async function metaConfig() {
  const config = await getMetaPlatformConfig();
  if (!config.appId || !config.appSecret || !config.redirectUri) throw new Error("Meta OAuth is not configured");
  return { ...config, version: config.graphApiVersion };
}

export function createOAuthState() {
  const state = crypto.randomBytes(32).toString("base64url");
  return { state, hash: crypto.createHash("sha256").update(state).digest("hex") };
}

export function buildMetaAuthorizationUrl(config: MetaPlatformConfig, state: string) {
  const url = new URL(`https://www.facebook.com/${config.graphApiVersion}/dialog/oauth`);
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", REQUIRED_META_PERMISSIONS.join(","));
  if (config.loginConfigurationId) url.searchParams.set("config_id", config.loginConfigurationId);
  return url;
}

export async function beginMetaOAuth() {
  const config = await metaConfig();
  const { state, hash } = createOAuthState();
  await prisma.oAuthState.create({ data: { stateHash: hash, redirectUri: config.redirectUri, expiresAt: new Date(Date.now() + 10 * 60_000) } });
  return buildMetaAuthorizationUrl(config, state).toString();
}

export async function getMetaOAuthDiagnostics() {
  const config = await getMetaPlatformConfig();
  const checks = {
    productionRedirect: config.redirectUri === "https://ai.growthifyx.space/api/meta/oauth/callback",
    loginConfigurationId: Boolean(config.loginConfigurationId),
    requiredPermissions: [...REQUIRED_META_PERMISSIONS],
    credentials: Boolean(config.appId && config.appSecret),
  };
  const constructible = Boolean(config.appId && config.redirectUri && config.graphApiVersion && buildMetaAuthorizationUrl(config, "diagnostic-state").toString());
  return { ok: checks.productionRedirect && checks.loginConfigurationId && checks.credentials && constructible, checks, authorizationUrl: constructible ? buildMetaAuthorizationUrl(config, "diagnostic-state").toString() : null };
}

async function metaJson<T>(url: URL, operation: string, init?: RequestInit): Promise<T> {
  return withProviderCircuit("meta", async () => {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
    const body = await response.json().catch(() => ({})) as T & { error?: { message?: string; code?: string | number; type?: string; error_subcode?: string | number } };
    if (!response.ok || body.error) {
      const providerError = body.error;
      throw new MetaApiError((providerError?.message ?? `Meta request failed (${response.status})`).slice(0, 500), { code: providerError?.code, type: providerError?.type, subcode: providerError?.error_subcode, operation });
    }
    return body;
  });
}

export async function consumeOAuthState(state: string) {
  const hash = crypto.createHash("sha256").update(state).digest("hex");
  const record = await prisma.oAuthState.findUnique({ where: { stateHash: hash } });
  if (!record || record.consumedAt || record.expiresAt < new Date()) throw new Error("Invalid or expired OAuth state");
  if (!record.callbackCompletedAt) {
    const claimed = await prisma.oAuthState.updateMany({ where: { id: record.id, callbackCompletedAt: null, consumedAt: null, expiresAt: { gt: new Date() } }, data: { callbackCompletedAt: new Date() } });
    if (claimed.count !== 1) throw new Error("Invalid or expired OAuth state");
  }
  return record;
}

export async function finalizeOAuthState(state: string) {
  const hash = crypto.createHash("sha256").update(state).digest("hex");
  const claimed = await prisma.oAuthState.updateMany({ where: { stateHash: hash, callbackCompletedAt: { not: null }, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date(), encryptedUserToken: null } });
  if (claimed.count !== 1) throw new Error("OAuth session has already been used or expired.");
}

export async function exchangeCode(code: string, redirectUri: string) {
  const config = await metaConfig();
  const url = new URL(`https://graph.facebook.com/${config.version}/oauth/access_token`);
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("client_secret", config.appSecret);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("code", code);
  return metaJson<{ access_token: string }>(url, "oauth.access_token");
}

export async function getGrantedPermissions(userAccessToken: string): Promise<MetaPermissionDiagnostic[]> {
  const config = await metaConfig();
  const url = new URL(`https://graph.facebook.com/${config.version}/me/permissions`);
  url.searchParams.set("access_token", userAccessToken);
  const result = await metaJson<{ data?: Array<{ permission?: string; status?: string }> }>(url, "oauth.permissions");
  const actual = new Map((result.data ?? []).filter((item) => item.permission).map((item) => [item.permission!, item.status?.toLowerCase() as MetaPermissionStatus]));
  return REQUIRED_META_PERMISSIONS.map((permission) => ({ permission, status: actual.get(permission) ?? "missing" }));
}

export function missingRequiredPermissions(permissions: MetaPermissionDiagnostic[]) {
  return permissions.filter((item) => item.status !== "granted");
}

export async function discoverPages(userAccessToken: string): Promise<MetaPage[]> {
  const config = await metaConfig();
  const url = new URL(`https://graph.facebook.com/${config.version}/me/accounts`);
  url.searchParams.set("fields", "id,name,access_token");
  url.searchParams.set("access_token", userAccessToken);
  const result = await metaJson<{ data?: MetaPage[] }>(url, "pages.discovery");
  return (result.data ?? []).filter((page) => page.id && page.name && page.access_token).map((page) => ({ id: page.id, name: page.name, access_token: page.access_token }));
}

export async function connectMetaPage(input: { pageId: string; metaPageId: string; name: string; pageAccessToken: string }) {
  const encryptedToken = encryptCredential(input.pageAccessToken);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.page.findUnique({ where: { metaPageId: input.metaPageId }, select: { id: true, slug: true, name: true } });
    if (existing && existing.id !== input.pageId) throw new DuplicateMetaPageError(existing.id, existing.slug, existing.name);
    const page = await tx.page.update({ where: { id: input.pageId }, data: { metaPageId: input.metaPageId, name: input.name, connectionStatus: "PENDING" } });
    await tx.pageConnection.upsert({ where: { pageId: page.id }, update: { encryptedToken, status: "PENDING", connectedAt: null, lastError: null, subscribedAt: null }, create: { pageId: page.id, encryptedToken, status: "PENDING" } });
    return page;
  });
}

export async function verifyMetaPage(pageAccessToken: string) {
  const config = await metaConfig();
  const url = new URL(`https://graph.facebook.com/${config.version}/me`);
  url.searchParams.set("fields", "id,name");
  url.searchParams.set("access_token", pageAccessToken);
  return metaJson<{ id: string; name: string }>(url, "page.identity");
}

export function verifyWebhookSignature(rawBody: string, signature: string | null, appSecret: string) {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  if (signature.slice(7).length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature.slice(7)), Buffer.from(expected));
}

export async function sendMetaMessage(pageAccessToken: string, recipientId: string, text: string) {
  const config = await metaConfig();
  const url = new URL(`https://graph.facebook.com/${config.version}/me/messages`);
  url.searchParams.set("access_token", pageAccessToken);
  return metaJson<{ message_id?: string }>(url, "messages.send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }) });
}

export async function subscribePageWebhooks(pageId: string, pageAccessToken: string) {
  const config = await metaConfig();
  const url = new URL(`https://graph.facebook.com/${config.version}/${pageId}/subscribed_apps`);
  url.searchParams.set("subscribed_fields", "messages,messaging_postbacks");
  url.searchParams.set("access_token", pageAccessToken);
  return metaJson<{ success: boolean }>(url, "page.webhook_subscription", { method: "POST" });
}

export async function healthCheckMetaPage(pageId: string) {
  const page = await prisma.page.findUnique({ where: { id: pageId }, include: { connection: true } });
  if (!page?.metaPageId || !page.connection?.encryptedToken) throw new Error("Page is not connected");
  try {
    const token = decryptCredential(page.connection.encryptedToken);
    const identity = await verifyMetaPage(token);
    if (identity.id !== page.metaPageId) throw new Error("Meta returned a different Page identity than the selected Page.");
    await subscribePageWebhooks(page.metaPageId, token);
    await prisma.$transaction([prisma.page.update({ where: { id: pageId }, data: { connectionStatus: "CONNECTED" } }), prisma.pageConnection.update({ where: { pageId }, data: { status: "CONNECTED", connectedAt: new Date(), lastHealthCheckAt: new Date(), lastHealthCheckStatus: "healthy", subscribedAt: new Date(), lastError: null } })]);
    return identity;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Meta health check failed";
    await prisma.$transaction([prisma.page.update({ where: { id: pageId }, data: { connectionStatus: "ERROR" } }), prisma.pageConnection.update({ where: { pageId }, data: { status: "ERROR", lastHealthCheckAt: new Date(), lastHealthCheckStatus: "error", lastError: message.slice(0, 500) } })]);
    throw error;
  }
}
