import { canonicalUrls, getEnv } from "@/lib/env";
import { prisma } from "@/lib/db/prisma";
import { decryptCredential, encryptCredential } from "@/lib/encryption/service";

const META_REQUIRED_PERMISSIONS = ["pages_show_list", "pages_read_engagement", "pages_manage_metadata", "pages_messaging", "business_management"] as const;
const META_GRAPH_VERSION = /^v\d+\.\d+$/;

export type MetaPlatformStatus = "READY" | "NOT_CONFIGURED";
export type MetaAutoConnectStatus = "AUTO_CONNECT_READY" | "AUTO_CONNECT_NOT_CONFIGURED";

export type MetaPlatformConfig = {
  appId: string;
  appSecret: string;
  verifyToken: string;
  graphApiVersion: string;
  loginConfigurationId: string;
  redirectUri: string;
  webhookUrl: string;
};

export function deriveMetaPlatformReadiness(config: MetaPlatformConfig): { status: MetaPlatformStatus; autoConnectStatus: MetaAutoConnectStatus; webhookConfigured: boolean } {
  const webhookConfigured = config.webhookUrl === canonicalUrls.metaWebhook;
  const ready = Boolean(
    config.appId.trim()
    && config.appSecret.trim()
    && config.verifyToken.trim()
    && META_GRAPH_VERSION.test(config.graphApiVersion.trim())
    && webhookConfigured
  );
  const autoConnectReady = ready && Boolean(config.loginConfigurationId.trim()) && config.redirectUri === canonicalUrls.metaRedirect;
  return {
    status: ready ? "READY" : "NOT_CONFIGURED",
    autoConnectStatus: autoConnectReady ? "AUTO_CONNECT_READY" : "AUTO_CONNECT_NOT_CONFIGURED",
    webhookConfigured,
  };
}

async function storedMetaSetting() {
  return prisma.metaPlatformSetting.findFirst({ orderBy: { createdAt: "asc" } });
}

export async function getMetaPlatformConfig(): Promise<MetaPlatformConfig> {
  const env = getEnv();
  const stored = await storedMetaSetting();
  return {
    appId: stored?.appId?.trim() || env.META_APP_ID?.trim() || "",
    appSecret: stored?.appSecretEncrypted ? decryptCredential(stored.appSecretEncrypted) : env.META_APP_SECRET?.trim() || "",
    verifyToken: stored?.verifyTokenEncrypted ? decryptCredential(stored.verifyTokenEncrypted) : env.META_VERIFY_TOKEN?.trim() || "",
    graphApiVersion: stored?.graphApiVersion || env.META_GRAPH_VERSION || "v23.0",
    loginConfigurationId: stored?.loginConfigurationId?.trim() || env.META_LOGIN_CONFIG_ID?.trim() || "",
    redirectUri: env.NODE_ENV === "production" ? canonicalUrls.metaRedirect : stored?.oauthRedirectUri || env.META_REDIRECT_URI || "http://localhost:3000/api/meta/oauth/callback",
    webhookUrl: stored?.webhookUrl || env.META_WEBHOOK_URL || canonicalUrls.metaWebhook,
  };
}

export async function getMetaControlCenter() {
  const config = await getMetaPlatformConfig();
  const stored = await storedMetaSetting();
  const readiness = deriveMetaPlatformReadiness(config);
  return {
    globalAiPaused: false,
    general: { applicationName: "Growthifyx AI Sales", canonicalDomain: canonicalUrls.app, currency: "BDT" as const, timezone: "Asia/Dhaka", country: "Bangladesh", language: "Auto" },
    meta: {
      appId: config.appId,
      appSecretConfigured: Boolean(config.appSecret),
      verifyTokenConfigured: Boolean(config.verifyToken),
      graphApiVersion: config.graphApiVersion,
      webhookUrl: canonicalUrls.metaWebhook,
      webhookConfigured: readiness.webhookConfigured,
      loginConfigurationId: config.loginConfigurationId,
      loginConfigurationConfigured: Boolean(config.loginConfigurationId),
      oauthRedirectUri: config.redirectUri,
      oauthRedirectConfigured: config.redirectUri === canonicalUrls.metaRedirect,
      requiredPermissions: [...META_REQUIRED_PERMISSIONS],
      status: readiness.status,
      autoConnectStatus: readiness.autoConnectStatus,
      lastError: stored?.lastError ?? null,
      lastTestAt: stored?.lastApiTestAt ?? null,
    },
  };
}

export async function saveMetaPlatformConfig(input: { appId: string; appSecret?: string; verifyToken?: string; graphApiVersion?: string; loginConfigurationId?: string }, adminId: string) {
  const current = await getMetaPlatformConfig();
  const appId = input.appId.trim();
  const appSecret = input.appSecret?.trim() || current.appSecret;
  const verifyToken = input.verifyToken?.trim() || current.verifyToken;
  const graphApiVersion = input.graphApiVersion?.trim() || current.graphApiVersion;
  const loginConfigurationId = input.loginConfigurationId === undefined ? current.loginConfigurationId : input.loginConfigurationId.trim();
  const nextConfig = { ...current, appId, appSecret, verifyToken, graphApiVersion, loginConfigurationId, redirectUri: canonicalUrls.metaRedirect, webhookUrl: canonicalUrls.metaWebhook };
  const status = deriveMetaPlatformReadiness(nextConfig).status === "READY" ? "READY" : "DEGRADED";

  await prisma.$transaction(async (tx) => {
    const existing = await tx.metaPlatformSetting.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
    const data = {
      appId,
      appSecretEncrypted: appSecret ? encryptCredential(appSecret) : null,
      verifyTokenEncrypted: verifyToken ? encryptCredential(verifyToken) : null,
      graphApiVersion,
      loginConfigurationId: loginConfigurationId || null,
      oauthRedirectUri: canonicalUrls.metaRedirect,
      webhookUrl: canonicalUrls.metaWebhook,
      status,
      lastError: null,
    };
    if (existing) await tx.metaPlatformSetting.update({ where: { id: existing.id }, data });
    else await tx.metaPlatformSetting.create({ data });
    await tx.auditLog.create({ data: { adminId, action: "meta.platform_configuration_changed" } });
  });
  return getMetaControlCenter();
}

export async function testMetaPlatformConfig(adminId: string) {
  const config = await getMetaPlatformConfig();
  const testedAt = new Date();
  const graphVersionValid = META_GRAPH_VERSION.test(config.graphApiVersion);
  let credentialsValid = false;
  let appIdMatched = false;
  let error: string | null = null;

  if (!config.appId || !config.appSecret || !graphVersionValid) {
    error = "Configure a valid Meta App ID, App Secret, and Graph API version before testing the app.";
  } else {
    try {
      const url = new URL(`https://graph.facebook.com/${config.graphApiVersion}/${encodeURIComponent(config.appId)}`);
      url.searchParams.set("fields", "id");
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json", Authorization: `Bearer ${config.appId}|${config.appSecret}` },
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({})) as { id?: string | number; error?: unknown };
      appIdMatched = String(body.id ?? "") === config.appId;
      credentialsValid = response.ok && !body.error && appIdMatched;
      if (!credentialsValid) error = "Meta rejected the configured App ID and App Secret relationship.";
    } catch {
      error = "Meta App validation is temporarily unavailable. The saved credentials were not changed.";
    }
  }

  const existing = await storedMetaSetting();
  if (existing) await prisma.metaPlatformSetting.update({ where: { id: existing.id }, data: { status: credentialsValid ? "READY" : "ERROR", lastApiTestAt: testedAt, lastError: error } });
  await prisma.auditLog.create({ data: { adminId, action: credentialsValid ? "meta.platform_configuration_tested" : "meta.platform_configuration_test_failed" } });
  return {
    control: await getMetaControlCenter(),
    diagnostics: {
      appIdConfigured: Boolean(config.appId),
      appSecretConfigured: Boolean(config.appSecret),
      graphApiVersion: config.graphApiVersion,
      credentialsValid,
      appIdMatched,
      testedAt: testedAt.toISOString(),
      message: error ?? "Meta confirmed the configured App ID and App Secret relationship.",
    },
  };
}

export async function testMetaWebhookConfiguration(adminId: string) {
  const config = await getMetaPlatformConfig();
  const testedAt = new Date();
  const readiness = deriveMetaPlatformReadiness(config);
  const latestSignedWebhook = await prisma.webhookEvent.findFirst({
    where: { signatureValid: true },
    orderBy: { receivedAt: "desc" },
    select: { receivedAt: true },
  });
  const configured = readiness.webhookConfigured && Boolean(config.verifyToken);
  const existing = await storedMetaSetting();
  const error = configured ? null : "Configure the canonical webhook endpoint and Webhook Verify Token before testing webhook configuration.";
  if (existing) await prisma.metaPlatformSetting.update({ where: { id: existing.id }, data: { lastApiTestAt: testedAt, lastError: error } });
  await prisma.auditLog.create({ data: { adminId, action: configured ? "meta.webhook_configuration_tested" : "meta.webhook_configuration_test_failed" } });
  return {
    control: await getMetaControlCenter(),
    diagnostics: {
      callbackUrl: canonicalUrls.metaWebhook,
      callbackConfigured: readiness.webhookConfigured,
      verifyTokenConfigured: Boolean(config.verifyToken),
      configured,
      lastSignedWebhookAt: latestSignedWebhook?.receivedAt.toISOString() ?? null,
      inboundWebhookObserved: Boolean(latestSignedWebhook),
      testedAt: testedAt.toISOString(),
      message: error ?? (latestSignedWebhook ? "Webhook configuration is ready and a successfully signed inbound webhook has been observed." : "Webhook configuration is ready. No successfully signed inbound webhook has been observed yet."),
    },
  };
}

export async function testMetaOAuthConfiguration(adminId: string) {
  const config = await getMetaPlatformConfig();
  const readiness = deriveMetaPlatformReadiness(config);
  const productionRedirect = config.redirectUri === canonicalUrls.metaRedirect;
  const constructible = Boolean(config.appId && META_GRAPH_VERSION.test(config.graphApiVersion) && config.redirectUri && new URL(`https://www.facebook.com/${config.graphApiVersion}/dialog/oauth`));
  const ready = readiness.autoConnectStatus === "AUTO_CONNECT_READY" && constructible;
  const error = ready ? null : "OAuth requires App ID, App Secret, Login Configuration ID, business_management plus the Page permissions, and the production redirect URI.";
  await prisma.auditLog.create({ data: { adminId, action: ready ? "meta.oauth_configuration_tested" : "meta.oauth_configuration_test_failed" } });
  return { control: await getMetaControlCenter(), diagnostics: { autoConnectStatus: readiness.autoConnectStatus, productionRedirect, loginConfigurationId: Boolean(config.loginConfigurationId), oauthUrlConstructible: constructible, requiredPermissions: [...META_REQUIRED_PERMISSIONS], message: error ?? "Automatic Facebook Login configuration is ready.", businessManagementNote: "business_management is required in the Meta Login Configuration for Business Portfolio Page discovery; direct Page access remains compatible when it is absent." } };
}
