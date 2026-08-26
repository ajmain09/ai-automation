import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { decryptCredential, encryptCredential } from "@/lib/encryption/service";
import { redactSensitiveText } from "@/lib/logging/logger";
import { upsertActionableIssue } from "@/services/issues/service";
import { getMetaPlatformConfig, type MetaPlatformConfig } from "@/services/meta/settings";
import { withProviderCircuit } from "@/services/resilience/retry";

export const FACEBOOK_SUBSCRIBED_FIELDS = ["messages", "messaging_postbacks"] as const;

export type FacebookFailureCode =
  | "TOKEN_INVALID"
  | "TOKEN_EXPIRED"
  | "APP_MISMATCH"
  | "PAGE_ID_MISMATCH"
  | "PERMISSION_ERROR"
  | "WEBHOOK_ERROR"
  | "META_UNAVAILABLE"
  | "PAGE_ALREADY_CONNECTED"
  | "TOKEN_REPLACEMENT_FAILED";

export type FacebookConnectionChecks = {
  pageIdentity: "PASS";
  tokenValidity: "PASS";
  metaAppMatch: "PASS";
  webhookSubscription: "PASS";
  messengerConnection: "PASS";
};

export type SafeFacebookPage = { id: string; slug: string; name: string; metaPageId: string };

export type FacebookConnectionResult = {
  page: SafeFacebookPage;
  checks: FacebookConnectionChecks;
};

export class FacebookConnectionError extends Error {
  constructor(
    readonly code: FacebookFailureCode,
    message: string,
    readonly reasonCode?: Exclude<FacebookFailureCode, "TOKEN_REPLACEMENT_FAILED">,
  ) {
    super(message);
    this.name = "FacebookConnectionError";
  }
}

export class FacebookPageAlreadyConnectedError extends FacebookConnectionError {
  constructor(readonly page: { id: string; slug: string; name: string }) {
    super("PAGE_ALREADY_CONNECTED", "Facebook Page already connected");
    this.name = "FacebookPageAlreadyConnectedError";
  }
}

class MetaGraphError extends Error {
  constructor(
    message: string,
    readonly details: {
      operation: string;
      httpStatus?: number;
      code?: string | number;
      subcode?: string | number;
      type?: string;
    },
  ) {
    super(message);
    this.name = "MetaGraphError";
  }
}

const identitySchema = z.object({ id: z.union([z.string(), z.number()]).transform(String), name: z.string().trim().min(1).max(160) });
const debugTokenSchema = z.object({
  data: z.object({
    is_valid: z.boolean().optional(),
    app_id: z.union([z.string(), z.number()]).transform(String).optional(),
    expires_at: z.number().optional(),
    data_access_expires_at: z.number().optional(),
    scopes: z.array(z.string()).optional(),
  }).optional(),
});
const subscriptionMutationSchema = z.object({ success: z.boolean() });
const subscriptionListSchema = z.object({
  data: z.array(z.object({
    id: z.union([z.string(), z.number()]).transform(String).optional(),
    subscribed_fields: z.array(z.string()).optional(),
  }).passthrough()).optional(),
});
const sendResultSchema = z.object({ message_id: z.string().min(1) });

type VerifiedCandidate = {
  identity: { id: string; name: string };
  scopes: string[];
};

type SubscriptionState = {
  subscribed: boolean;
  fields: string[];
  fieldsConfirmed: boolean | null;
};

function safeErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  return redactSensitiveText(message).slice(0, 500);
}

function appAccessToken(config: MetaPlatformConfig) {
  return `${config.appId}|${config.appSecret}`;
}

function assertMetaMessengerReady(config: MetaPlatformConfig) {
  const graphVersionValid = /^v\d+\.\d+$/.test(config.graphApiVersion);
  if (!config.appId || !config.appSecret || !config.verifyToken || !config.webhookUrl || !graphVersionValid) {
    throw new FacebookConnectionError("META_UNAVAILABLE", "Global Meta Platform settings are not ready for Messenger.");
  }
}

function graphUrl(config: MetaPlatformConfig, path: string, fields?: string) {
  const url = new URL(`https://graph.facebook.com/${config.graphApiVersion}/${path.replace(/^\//, "")}`);
  if (fields) url.searchParams.set("fields", fields);
  return url;
}

async function graphJson<T>(input: {
  config: MetaPlatformConfig;
  pageScope: string;
  path: string;
  operation: string;
  token: string;
  method?: "GET" | "POST" | "DELETE";
  fields?: string;
  body?: URLSearchParams | Record<string, unknown>;
}): Promise<T> {
  const url = graphUrl(input.config, input.path, input.fields);
  const isForm = input.body instanceof URLSearchParams;
  const headers: Record<string, string> = { Authorization: `Bearer ${input.token}` };
  if (input.body) headers["Content-Type"] = isForm ? "application/x-www-form-urlencoded" : "application/json";
  const body = input.body ? (isForm ? input.body.toString() : JSON.stringify(input.body)) : undefined;
  return withProviderCircuit(`meta:page:${input.pageScope}`, async () => {
    let response: Response;
    try {
      response = await fetch(url, { method: input.method ?? "GET", headers, body, signal: AbortSignal.timeout(10_000) });
    } catch (error) {
      throw new MetaGraphError(safeErrorMessage(error, "Meta request failed"), { operation: input.operation });
    }
    const payload = await response.json().catch(() => ({})) as T & {
      error?: { message?: string; code?: string | number; error_subcode?: string | number; type?: string };
    };
    if (!response.ok || payload.error) {
      throw new MetaGraphError(
        safeErrorMessage(payload.error?.message ?? `Meta request failed (${response.status})`, "Meta request failed"),
        {
          operation: input.operation,
          httpStatus: response.status,
          code: payload.error?.code,
          subcode: payload.error?.error_subcode,
          type: payload.error?.type,
        },
      );
    }
    return payload;
  });
}

function isExpiredMetaError(error: MetaGraphError) {
  return String(error.details.subcode ?? "") === "463" || /expired/i.test(error.message);
}

function normalizeFacebookError(error: unknown, operation = "facebook.connection"): FacebookConnectionError {
  if (error instanceof FacebookConnectionError) return error;
  if (error instanceof MetaGraphError) {
    if (isExpiredMetaError(error)) return new FacebookConnectionError("TOKEN_EXPIRED", "The Facebook Page Access Token has expired.");
    if (String(error.details.code ?? "") === "190") return new FacebookConnectionError("TOKEN_INVALID", "The Facebook Page Access Token is invalid.");
    if (["10", "200"].includes(String(error.details.code ?? ""))) return new FacebookConnectionError("PERMISSION_ERROR", "The Page token cannot perform the required Messenger operation.");
    if ((error.details.httpStatus ?? 0) >= 500 || !error.details.httpStatus || /timeout|abort|network|fetch/i.test(error.message)) {
      return new FacebookConnectionError("META_UNAVAILABLE", "Meta is temporarily unavailable. Try again shortly.");
    }
    if (/subscription/i.test(error.details.operation)) return new FacebookConnectionError("WEBHOOK_ERROR", "Facebook webhook subscription could not be verified.");
    return new FacebookConnectionError("TOKEN_INVALID", "The Facebook Page Access Token could not be verified.");
  }
  const message = safeErrorMessage(error, operation);
  if (/decrypt|encrypted credential/i.test(message)) return new FacebookConnectionError("TOKEN_INVALID", "The saved Facebook Page credential is unreadable.");
  return new FacebookConnectionError("META_UNAVAILABLE", "Facebook connection verification could not be completed.");
}

function issueTypeFor(code: FacebookFailureCode) {
  if (code === "TOKEN_INVALID") return "FACEBOOK_TOKEN_INVALID";
  if (code === "TOKEN_EXPIRED") return "FACEBOOK_TOKEN_EXPIRED";
  if (code === "APP_MISMATCH") return "FACEBOOK_APP_MISMATCH";
  if (code === "PAGE_ID_MISMATCH") return "FACEBOOK_PAGE_MISMATCH";
  if (code === "WEBHOOK_ERROR" || code === "PERMISSION_ERROR") return "FACEBOOK_WEBHOOK_ERROR";
  return "FACEBOOK_CONNECTION_ERROR";
}

async function recordConnectionIssue(pageId: string, error: FacebookConnectionError) {
  await upsertActionableIssue({
    pageId,
    type: issueTypeFor(error.reasonCode ?? error.code),
    title: "Facebook Messenger connection needs attention",
    description: error.message,
    severity: "high",
    resolutionAction: error.code === "APP_MISMATCH"
      ? "Generate the Page token from the Meta App configured in Growthifyx."
      : "Verify the Page credential and repair the Facebook connection.",
    metadata: { reasonCode: error.reasonCode ?? error.code },
  }).catch(() => undefined);
}

async function fetchPageIdentity(config: MetaPlatformConfig, metaPageId: string, token: string) {
  try {
    const payload = await graphJson<unknown>({ config, pageScope: metaPageId, path: "me", operation: "page.identity", token, fields: "id,name" });
    return identitySchema.parse(payload);
  } catch (error) {
    if (error instanceof z.ZodError) throw new FacebookConnectionError("TOKEN_INVALID", "Meta did not return a valid Facebook Page identity.");
    throw error;
  }
}

async function debugPageToken(config: MetaPlatformConfig, metaPageId: string, token: string) {
  let payload: unknown;
  try {
    payload = await graphJson<unknown>({
      config,
      pageScope: metaPageId,
      path: "debug_token",
      operation: "page.token_debug",
      token: appAccessToken(config),
      method: "POST",
      body: new URLSearchParams({ input_token: token }),
    });
  } catch (error) {
    throw normalizeFacebookError(error, "page.token_debug");
  }
  const result = debugTokenSchema.safeParse(payload);
  if (!result.success || result.data.data?.is_valid !== true) {
    const expiredAt = result.success ? result.data.data?.expires_at : undefined;
    if (expiredAt && expiredAt * 1000 <= Date.now()) throw new FacebookConnectionError("TOKEN_EXPIRED", "The Facebook Page Access Token has expired.");
    throw new FacebookConnectionError("TOKEN_INVALID", "The Facebook Page Access Token is invalid.");
  }
  if (result.data.data.app_id !== config.appId) {
    throw new FacebookConnectionError("APP_MISMATCH", "This Page token was issued for another Meta App. Generate the Page token from the Meta App configured in Growthifyx.");
  }
  return { scopes: result.data.data.scopes ?? [] };
}

export async function verifyFacebookCredentialCandidate(metaPageId: string, pageAccessToken: string): Promise<VerifiedCandidate> {
  const config = await getMetaPlatformConfig();
  assertMetaMessengerReady(config);
  try {
    const identity = await fetchPageIdentity(config, metaPageId, pageAccessToken);
    if (identity.id !== metaPageId) {
      throw new FacebookConnectionError("PAGE_ID_MISMATCH", "The supplied Page Access Token belongs to a different Facebook Page.");
    }
    const debug = await debugPageToken(config, metaPageId, pageAccessToken);
    return { identity, scopes: debug.scopes };
  } catch (error) {
    throw normalizeFacebookError(error, "page.credential_verification");
  }
}

async function getSubscriptionState(config: MetaPlatformConfig, metaPageId: string, token: string): Promise<SubscriptionState> {
  let payload: unknown;
  try {
    payload = await graphJson<unknown>({
      config,
      pageScope: metaPageId,
      path: `${encodeURIComponent(metaPageId)}/subscribed_apps`,
      operation: "page.subscription_status",
      token,
      fields: "id,subscribed_fields",
    });
  } catch (error) {
    throw normalizeFacebookError(error, "page.subscription_status");
  }
  const parsed = subscriptionListSchema.safeParse(payload);
  if (!parsed.success) throw new FacebookConnectionError("WEBHOOK_ERROR", "Meta returned an invalid webhook subscription response.");
  const app = (parsed.data.data ?? []).find((item) => item.id === config.appId);
  const fields = app?.subscribed_fields ?? [];
  const fieldsConfirmed = app && Array.isArray(app.subscribed_fields)
    ? FACEBOOK_SUBSCRIBED_FIELDS.every((field) => fields.includes(field))
    : null;
  return { subscribed: Boolean(app), fields, fieldsConfirmed };
}

async function mutateSubscription(config: MetaPlatformConfig, metaPageId: string, token: string, method: "POST" | "DELETE") {
  let payload: unknown;
  try {
    payload = await graphJson<unknown>({
      config,
      pageScope: metaPageId,
      path: `${encodeURIComponent(metaPageId)}/subscribed_apps`,
      operation: method === "POST" ? "page.subscription_repair" : "page.subscription_remove",
      token,
      method,
      ...(method === "POST" ? { body: new URLSearchParams({ subscribed_fields: FACEBOOK_SUBSCRIBED_FIELDS.join(",") }) } : {}),
    });
  } catch (error) {
    throw normalizeFacebookError(error, "page.subscription_mutation");
  }
  const parsed = subscriptionMutationSchema.safeParse(payload);
  if (!parsed.success || !parsed.data.success) throw new FacebookConnectionError("WEBHOOK_ERROR", "Meta did not confirm the Facebook webhook subscription change.");
}

async function ensureFacebookSubscription(metaPageId: string, token: string, force = false) {
  const config = await getMetaPlatformConfig();
  assertMetaMessengerReady(config);
  const before = await getSubscriptionState(config, metaPageId, token);
  const readyBefore = before.subscribed && before.fieldsConfirmed !== false;
  if (force || !readyBefore) await mutateSubscription(config, metaPageId, token, "POST");
  const after = await getSubscriptionState(config, metaPageId, token);
  if (!after.subscribed || after.fieldsConfirmed === false) {
    throw new FacebookConnectionError("WEBHOOK_ERROR", "Growthifyx could not confirm the required Facebook webhook subscription.");
  }
  return { before, after };
}

function connectedChecks(): FacebookConnectionChecks {
  return {
    pageIdentity: "PASS",
    tokenValidity: "PASS",
    metaAppMatch: "PASS",
    webhookSubscription: "PASS",
    messengerConnection: "PASS",
  };
}

function safePage(page: { id: string; slug: string; name: string; metaPageId: string | null }): SafeFacebookPage {
  if (!page.metaPageId) throw new FacebookConnectionError("PAGE_ID_MISMATCH", "The Facebook Page identity was not saved.");
  return { id: page.id, slug: page.slug, name: page.name, metaPageId: page.metaPageId };
}

function pageSlug(name: string) {
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "facebook-page";
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

async function rollbackNewSubscription(metaPageId: string, token: string, wasSubscribed: boolean) {
  if (wasSubscribed) return;
  try {
    const config = await getMetaPlatformConfig();
    await mutateSubscription(config, metaPageId, token, "DELETE");
  } catch {
    await upsertActionableIssue({
      type: "FACEBOOK_WEBHOOK_ERROR",
      title: "Facebook subscription cleanup requires attention",
      description: "A verified Facebook subscription could not be cleaned up after local connection finalization failed.",
      severity: "high",
      resolutionAction: "Review the Growthifyx app subscription for the affected Meta Page ID.",
      metadata: { metaPageId },
    }).catch(() => undefined);
  }
}

type ConnectInput = {
  metaPageId: string;
  pageAccessToken: string;
  adminId: string;
  existingPageId?: string;
  connectionMethod: "MANUAL" | "OAUTH";
};

async function connectFacebookPageInternal(input: ConnectInput): Promise<FacebookConnectionResult> {
  const existingByMetaId = await prisma.page.findUnique({
    where: { metaPageId: input.metaPageId },
    select: { id: true, slug: true, name: true },
  });
  if (existingByMetaId && existingByMetaId.id !== input.existingPageId) throw new FacebookPageAlreadyConnectedError(existingByMetaId);

  const workspace = input.existingPageId ? await prisma.page.findUnique({
    where: { id: input.existingPageId },
    select: { id: true, slug: true, name: true, metaPageId: true, connectionStatus: true, connection: true },
  }) : null;
  if (input.existingPageId && !workspace) throw new FacebookConnectionError("PAGE_ID_MISMATCH", "The selected Growthifyx Page workspace was not found.");
  if (workspace?.metaPageId && workspace.metaPageId !== input.metaPageId) {
    throw new FacebookConnectionError("PAGE_ID_MISMATCH", "The replacement credential does not belong to this Growthifyx Page workspace.");
  }

  const candidate = await verifyFacebookCredentialCandidate(input.metaPageId, input.pageAccessToken);
  const duplicateAfterVerification = await prisma.page.findUnique({
    where: { metaPageId: input.metaPageId },
    select: { id: true, slug: true, name: true },
  });
  if (duplicateAfterVerification && duplicateAfterVerification.id !== input.existingPageId) throw new FacebookPageAlreadyConnectedError(duplicateAfterVerification);

  const subscription = await ensureFacebookSubscription(input.metaPageId, input.pageAccessToken);
  const encryptedToken = encryptCredential(input.pageAccessToken);
  const now = new Date();
  const rotating = Boolean(workspace?.connection?.encryptedToken);
  try {
    const page = await prisma.$transaction(async (tx) => {
      const concurrentDuplicate = await tx.page.findUnique({
        where: { metaPageId: input.metaPageId },
        select: { id: true, slug: true, name: true },
      });
      if (concurrentDuplicate && concurrentDuplicate.id !== input.existingPageId) throw new FacebookPageAlreadyConnectedError(concurrentDuplicate);

      let connectedPage: { id: string; slug: string; name: string; metaPageId: string | null };
      if (workspace) {
        connectedPage = await tx.page.update({
          where: { id: workspace.id },
          data: { metaPageId: input.metaPageId, name: candidate.identity.name, connectionStatus: "CONNECTED" },
          select: { id: true, slug: true, name: true, metaPageId: true },
        });
        await tx.pageConnection.upsert({
          where: { pageId: workspace.id },
          update: {
            encryptedToken,
            status: "CONNECTED",
            connectedAt: workspace.connection?.connectedAt ?? now,
            subscribedAt: workspace.connection?.subscribedAt ?? now,
            lastHealthCheckAt: now,
            lastHealthCheckStatus: "healthy",
            lastError: null,
          },
          create: {
            pageId: workspace.id,
            encryptedToken,
            status: "CONNECTED",
            connectedAt: now,
            subscribedAt: now,
            lastHealthCheckAt: now,
            lastHealthCheckStatus: "healthy",
          },
        });
      } else {
        connectedPage = await tx.page.create({
          data: {
            metaPageId: input.metaPageId,
            name: candidate.identity.name,
            slug: pageSlug(candidate.identity.name),
            connectionStatus: "CONNECTED",
            settings: {
              create: {
                countryCode: "BD",
                currency: "BDT",
                requiredOrderFields: ["name", "phone", "address", "product", "variant", "quantity"],
              },
            },
            configurationVersions: { create: { version: 1, status: "DRAFT", label: "Initial draft" } },
            connection: {
              create: {
                encryptedToken,
                status: "CONNECTED",
                connectedAt: now,
                subscribedAt: now,
                lastHealthCheckAt: now,
                lastHealthCheckStatus: "healthy",
              },
            },
          },
          select: { id: true, slug: true, name: true, metaPageId: true },
        });
      }
      await tx.auditLog.create({
        data: {
          adminId: input.adminId,
          pageId: connectedPage.id,
          action: rotating ? "facebook.credential_rotated" : "facebook.page_connected",
          metadata: { metaPageId: input.metaPageId, connectionMethod: input.connectionMethod },
        },
      });
      return connectedPage;
    });
    return { page: safePage(page), checks: connectedChecks() };
  } catch (error) {
    if (error instanceof FacebookPageAlreadyConnectedError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const duplicate = await prisma.page.findUnique({ where: { metaPageId: input.metaPageId }, select: { id: true, slug: true, name: true } });
      if (duplicate) throw new FacebookPageAlreadyConnectedError(duplicate);
    }
    if (!workspace) await rollbackNewSubscription(input.metaPageId, input.pageAccessToken, subscription.before.subscribed);
    await upsertActionableIssue({
      type: "FACEBOOK_CONNECTION_FINALIZATION_ERROR",
      title: "Facebook Page connection could not be finalized",
      description: "The Facebook credential was verified, but the local Page workspace transaction failed.",
      severity: "high",
      resolutionAction: "Review database health and retry the Page connection.",
      metadata: { metaPageId: input.metaPageId },
    }).catch(() => undefined);
    throw new FacebookConnectionError("META_UNAVAILABLE", "The Facebook Page was verified, but Growthifyx could not finalize the connection.");
  }
}

export async function connectFacebookPage(input: ConnectInput): Promise<FacebookConnectionResult> {
  try {
    return await connectFacebookPageInternal(input);
  } catch (error) {
    if (!input.existingPageId || error instanceof FacebookPageAlreadyConnectedError) throw normalizeFacebookError(error);
    const reason = normalizeFacebookError(error);
    const replacementError = new FacebookConnectionError(
      "TOKEN_REPLACEMENT_FAILED",
      "The replacement Facebook Page token failed verification. The existing credential remains active.",
      reason.code === "TOKEN_REPLACEMENT_FAILED" ? "META_UNAVAILABLE" : reason.code,
    );
    await prisma.auditLog.create({
      data: {
        adminId: input.adminId,
        pageId: input.existingPageId,
        action: "facebook.credential_rotation_failed",
        metadata: { metaPageId: input.metaPageId, reasonCode: replacementError.reasonCode },
      },
    }).catch(() => undefined);
    await recordConnectionIssue(input.existingPageId, replacementError);
    throw replacementError;
  }
}

async function storedFacebookCredential(pageId: string) {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: {
      id: true,
      slug: true,
      name: true,
      metaPageId: true,
      isActive: true,
      aiEnabled: true,
      aiStatus: true,
      lifecycleStatus: true,
      connectionStatus: true,
      connection: true,
    },
  });
  if (!page?.metaPageId || !page.connection?.encryptedToken) throw new FacebookConnectionError("TOKEN_INVALID", "This Page does not have a configured Facebook credential.");
  return { page, token: decryptCredential(page.connection.encryptedToken) };
}

async function markConnectionFailure(pageId: string, error: FacebookConnectionError, adminId?: string, action = "facebook.connection_test_failed") {
  const message = safeErrorMessage(error, "Facebook connection failed");
  await prisma.$transaction(async (tx) => {
    await tx.page.update({ where: { id: pageId }, data: { connectionStatus: "ERROR" } });
    await tx.pageConnection.update({
      where: { pageId },
      data: { status: "ERROR", lastHealthCheckAt: new Date(), lastHealthCheckStatus: `error:${error.code}`, lastError: message },
    });
    if (adminId) await tx.auditLog.create({ data: { adminId, pageId, action, metadata: { reasonCode: error.code } } });
  }).catch(() => undefined);
  await recordConnectionIssue(pageId, error);
}

export async function testFacebookConnection(pageId: string, adminId?: string): Promise<FacebookConnectionResult> {
  try {
    const stored = await storedFacebookCredential(pageId);
    const candidate = await verifyFacebookCredentialCandidate(stored.page.metaPageId!, stored.token);
    const config = await getMetaPlatformConfig();
    const subscription = await getSubscriptionState(config, stored.page.metaPageId!, stored.token);
    if (!subscription.subscribed || subscription.fieldsConfirmed === false) throw new FacebookConnectionError("WEBHOOK_ERROR", "The Growthifyx Meta App is not subscribed to this Facebook Page.");
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.page.update({ where: { id: pageId }, data: { name: candidate.identity.name, connectionStatus: "CONNECTED" } });
      await tx.pageConnection.update({ where: { pageId }, data: { status: "CONNECTED", lastHealthCheckAt: now, lastHealthCheckStatus: "healthy", lastError: null } });
      if (adminId) await tx.auditLog.create({ data: { adminId, pageId, action: "facebook.connection_tested" } });
    });
    return { page: safePage({ ...stored.page, name: candidate.identity.name }), checks: connectedChecks() };
  } catch (error) {
    const normalized = normalizeFacebookError(error);
    await markConnectionFailure(pageId, normalized, adminId);
    throw normalized;
  }
}

export async function repairFacebookSubscription(pageId: string, adminId: string): Promise<FacebookConnectionResult> {
  try {
    const stored = await storedFacebookCredential(pageId);
    const candidate = await verifyFacebookCredentialCandidate(stored.page.metaPageId!, stored.token);
    await ensureFacebookSubscription(stored.page.metaPageId!, stored.token, true);
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.page.update({ where: { id: pageId }, data: { name: candidate.identity.name, connectionStatus: "CONNECTED" } });
      await tx.pageConnection.update({ where: { pageId }, data: { status: "CONNECTED", subscribedAt: now, lastHealthCheckAt: now, lastHealthCheckStatus: "healthy", lastError: null } });
      await tx.auditLog.create({ data: { adminId, pageId, action: "facebook.webhook_repaired" } });
    });
    return { page: safePage({ ...stored.page, name: candidate.identity.name }), checks: connectedChecks() };
  } catch (error) {
    const normalized = normalizeFacebookError(error);
    await markConnectionFailure(pageId, normalized, adminId, "facebook.webhook_repair_failed");
    throw normalized;
  }
}

export async function disconnectFacebookPage(pageId: string, adminId: string, unsubscribe = true) {
  const page = await prisma.page.findUnique({ where: { id: pageId }, select: { id: true, metaPageId: true, connection: true } });
  if (!page) throw new FacebookConnectionError("PAGE_ID_MISMATCH", "Page workspace not found.");
  let unsubscribeSucceeded: boolean | null = null;
  let warning: string | null = null;
  if (unsubscribe && page.metaPageId && page.connection?.encryptedToken) {
    try {
      const config = await getMetaPlatformConfig();
      await mutateSubscription(config, page.metaPageId, decryptCredential(page.connection.encryptedToken), "DELETE");
      unsubscribeSucceeded = true;
    } catch (error) {
      unsubscribeSucceeded = false;
      warning = "Growthifyx disconnected locally, but Meta did not confirm webhook removal.";
      const normalized = normalizeFacebookError(error);
      await recordConnectionIssue(pageId, normalized);
    }
  }
  await prisma.$transaction(async (tx) => {
    await tx.page.update({ where: { id: pageId }, data: { connectionStatus: "DISCONNECTED" } });
    await tx.pageConnection.upsert({
      where: { pageId },
      update: { encryptedToken: null, status: "DISCONNECTED", connectedAt: null, subscribedAt: null, lastHealthCheckAt: new Date(), lastHealthCheckStatus: "disconnected", lastError: warning },
      create: { pageId, status: "DISCONNECTED", lastHealthCheckAt: new Date(), lastHealthCheckStatus: "disconnected", lastError: warning },
    });
    await tx.auditLog.create({ data: { adminId, pageId, action: "facebook.page_disconnected", metadata: { unsubscribeRequested: unsubscribe, unsubscribeSucceeded } } });
  });
  return { disconnected: true, unsubscribeSucceeded, warning };
}

export async function sendFacebookMessage(input: { pageId: string; recipientId: string; text: string }) {
  const stored = await storedFacebookCredential(input.pageId);
  const { page, token } = stored;
  const transportReady = page.isActive
    && page.lifecycleStatus === "LIVE"
    && page.aiEnabled
    && page.aiStatus === "RUNNING"
    && page.connectionStatus === "CONNECTED"
    && page.connection?.status === "CONNECTED";
  if (!transportReady) throw new FacebookConnectionError("META_UNAVAILABLE", "Facebook Messenger transport is not connected for this Page.");
  const config = await getMetaPlatformConfig();
  assertMetaMessengerReady(config);
  try {
    const payload = await graphJson<unknown>({
      config,
      pageScope: input.pageId,
      path: `${encodeURIComponent(page.metaPageId!)}/messages`,
      operation: "messages.send",
      token,
      method: "POST",
      body: { recipient: { id: input.recipientId }, message: { text: input.text } },
    });
    return sendResultSchema.parse(payload);
  } catch (error) {
    if (error instanceof z.ZodError) throw new FacebookConnectionError("META_UNAVAILABLE", "Meta did not return a Messenger provider message ID.");
    throw normalizeFacebookError(error, "messages.send");
  }
}
