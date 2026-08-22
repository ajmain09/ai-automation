import crypto from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { encryptCredential } from "@/lib/encryption/service";
import { decryptCredential } from "@/lib/encryption/service";
import { getEnv } from "@/lib/env";
import { withProviderCircuit } from "@/services/resilience/retry";

export type MetaPage = { id: string; name: string; access_token: string };

function metaConfig() {
  const env = getEnv();
  if (!env.META_APP_ID || !env.META_APP_SECRET || !env.META_REDIRECT_URI) throw new Error("Meta OAuth is not configured");
  return { ...env, version: env.META_GRAPH_VERSION ?? "v23.0" };
}

export function createOAuthState() {
  const state = crypto.randomBytes(32).toString("base64url");
  return { state, hash: crypto.createHash("sha256").update(state).digest("hex") };
}

export async function beginMetaOAuth() {
  const config = metaConfig();
  const { state, hash } = createOAuthState();
  await prisma.oAuthState.create({ data: { stateHash: hash, redirectUri: config.META_REDIRECT_URI!, expiresAt: new Date(Date.now() + 10 * 60_000) } });
  const url = new URL(`https://www.facebook.com/${config.version}/dialog/oauth`);
  url.searchParams.set("client_id", config.META_APP_ID!);
  url.searchParams.set("redirect_uri", config.META_REDIRECT_URI!);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", "pages_show_list,pages_read_engagement,pages_manage_metadata,pages_messaging");
  return url.toString();
}

async function metaJson<T>(url: URL, init?: RequestInit): Promise<T> {
  return withProviderCircuit("meta", async () => {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
    const body = await response.json() as T & { error?: { message?: string } };
    if (!response.ok || body.error) throw new Error(body.error?.message ?? `Meta request failed (${response.status})`);
    return body;
  });
}

export async function consumeOAuthState(state: string) {
  const hash = crypto.createHash("sha256").update(state).digest("hex");
  const record = await prisma.oAuthState.findUnique({ where: { stateHash: hash } });
  if (!record || record.consumedAt || record.expiresAt < new Date()) throw new Error("Invalid or expired OAuth state");
  return record;
}

export async function exchangeCode(code: string, redirectUri: string) {
  const config = metaConfig();
  const url = new URL(`https://graph.facebook.com/${config.version}/oauth/access_token`);
  url.searchParams.set("client_id", config.META_APP_ID!);
  url.searchParams.set("client_secret", config.META_APP_SECRET!);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("code", code);
  return metaJson<{ access_token: string }>(url);
}

export async function discoverPages(userAccessToken: string): Promise<MetaPage[]> {
  const config = metaConfig();
  const url = new URL(`https://graph.facebook.com/${config.version}/me/accounts`);
  url.searchParams.set("fields", "id,name,access_token");
  url.searchParams.set("access_token", userAccessToken);
  const result = await metaJson<{ data: MetaPage[] }>(url);
  return result.data.map((page) => ({ id: page.id, name: page.name, access_token: page.access_token }));
}

export async function connectMetaPage(input: { pageId: string; metaPageId: string; name: string; pageAccessToken: string }) {
  const encryptedToken = encryptCredential(input.pageAccessToken);
  return prisma.$transaction(async (tx) => {
    const page = await tx.page.update({ where: { id: input.pageId }, data: { metaPageId: input.metaPageId, name: input.name, connectionStatus: "CONNECTED" } });
    await tx.pageConnection.upsert({ where: { pageId: page.id }, update: { encryptedToken, status: "CONNECTED", connectedAt: new Date(), lastError: null }, create: { pageId: page.id, encryptedToken, status: "CONNECTED", connectedAt: new Date() } });
    return page;
  });
}

export async function verifyMetaPage(pageAccessToken: string) {
  const config = metaConfig();
  const url = new URL(`https://graph.facebook.com/${config.version}/me`);
  url.searchParams.set("fields", "id,name");
  url.searchParams.set("access_token", pageAccessToken);
  return metaJson<{ id: string; name: string }>(url);
}

export function verifyWebhookSignature(rawBody: string, signature: string | null, appSecret: string) {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  if (signature.slice(7).length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature.slice(7)), Buffer.from(expected));
}

export async function sendMetaMessage(pageAccessToken: string, recipientId: string, text: string) {
  const config = metaConfig();
  const url = new URL(`https://graph.facebook.com/${config.version}/me/messages`);
  url.searchParams.set("access_token", pageAccessToken);
  return metaJson<{ message_id?: string }>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }) });
}

export async function subscribePageWebhooks(pageId: string, pageAccessToken: string) {
  const config = metaConfig();
  const url = new URL(`https://graph.facebook.com/${config.version}/${pageId}/subscribed_apps`);
  url.searchParams.set("subscribed_fields", "messages,messaging_postbacks,messaging_optins");
  url.searchParams.set("access_token", pageAccessToken);
  return metaJson<{ success: boolean }>(url, { method: "POST" });
}

export async function healthCheckMetaPage(pageId: string) {
  const page = await prisma.page.findUnique({ where: { id: pageId }, include: { connection: true } });
  if (!page?.metaPageId || !page.connection?.encryptedToken) throw new Error("Page is not connected");
  try {
    const token = decryptCredential(page.connection.encryptedToken);
    const identity = await verifyMetaPage(token);
    await subscribePageWebhooks(page.metaPageId, token);
    await prisma.$transaction([prisma.page.update({ where: { id: pageId }, data: { connectionStatus: "CONNECTED" } }), prisma.pageConnection.update({ where: { pageId }, data: { status: "CONNECTED", lastHealthCheckAt: new Date(), lastHealthCheckStatus: "healthy", subscribedAt: new Date(), lastError: null } })]);
    return identity;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Meta health check failed";
    await prisma.$transaction([prisma.page.update({ where: { id: pageId }, data: { connectionStatus: "ERROR" } }), prisma.pageConnection.update({ where: { pageId }, data: { status: "ERROR", lastHealthCheckAt: new Date(), lastHealthCheckStatus: "error", lastError: message.slice(0, 500) } })]);
    throw error;
  }
}
