import { canonicalUrls, getEnv } from "@/lib/env";
import { prisma } from "@/lib/db/prisma";
import { decryptCredential, encryptCredential } from "@/lib/encryption/service";

export type MetaPlatformConfig = {
  appId: string;
  appSecret: string;
  verifyToken: string;
  graphApiVersion: string;
  loginConfigurationId: string;
  redirectUri: string;
  webhookUrl: string;
};

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
  const configured = Boolean(config.appId && config.appSecret && config.verifyToken && config.loginConfigurationId && config.redirectUri === canonicalUrls.metaRedirect);
  return {
    globalAiPaused: false,
    general: { applicationName: "Growthifyx AI Sales", canonicalDomain: canonicalUrls.app, currency: "BDT" as const, timezone: "Asia/Dhaka", country: "Bangladesh", language: "Auto" },
    meta: {
      appId: config.appId,
      appSecretConfigured: Boolean(config.appSecret),
      verifyTokenConfigured: Boolean(config.verifyToken),
      graphApiVersion: config.graphApiVersion,
      loginConfigurationId: config.loginConfigurationId,
      loginConfigurationConfigured: Boolean(config.loginConfigurationId),
      oauthRedirectUri: config.redirectUri,
      oauthRedirectConfigured: config.redirectUri === canonicalUrls.metaRedirect,
      requiredPermissions: ["pages_show_list", "pages_read_engagement", "pages_manage_metadata", "pages_messaging"],
      status: configured ? "READY" as const : "NOT_CONFIGURED" as const,
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
  const loginConfigurationId = input.loginConfigurationId?.trim() || current.loginConfigurationId;
  const status = appId && appSecret && verifyToken && loginConfigurationId ? "READY" : "DEGRADED";

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
  const ready = Boolean(config.appId && config.appSecret && config.verifyToken && config.loginConfigurationId && config.redirectUri === canonicalUrls.metaRedirect);
  const error = ready ? null : "Configure the Meta App ID, App Secret, Webhook Verify Token, Login Configuration ID, and production OAuth redirect first.";
  const existing = await storedMetaSetting();
  if (existing) await prisma.metaPlatformSetting.update({ where: { id: existing.id }, data: { status: ready ? "READY" : "ERROR", lastApiTestAt: new Date(), lastError: error } });
  await prisma.auditLog.create({ data: { adminId, action: ready ? "meta.platform_configuration_tested" : "meta.platform_configuration_test_failed" } });
  return getMetaControlCenter();
}

export async function testMetaOAuthConfiguration(adminId: string) {
  const config = await getMetaPlatformConfig();
  const productionRedirect = config.redirectUri === canonicalUrls.metaRedirect;
  const constructible = Boolean(config.appId && config.graphApiVersion && config.redirectUri && new URL(`https://www.facebook.com/${config.graphApiVersion}/dialog/oauth`));
  const ready = Boolean(config.appId && config.appSecret && config.loginConfigurationId && productionRedirect && constructible);
  const error = ready ? null : "OAuth requires App ID, App Secret, Login Configuration ID, required permissions, and the production redirect URI.";
  const existing = await storedMetaSetting();
  if (existing) await prisma.metaPlatformSetting.update({ where: { id: existing.id }, data: { status: ready ? "READY" : "ERROR", lastApiTestAt: new Date(), lastError: error } });
  await prisma.auditLog.create({ data: { adminId, action: ready ? "meta.oauth_configuration_tested" : "meta.oauth_configuration_test_failed" } });
  return { control: await getMetaControlCenter(), diagnostics: { productionRedirect, loginConfigurationId: Boolean(config.loginConfigurationId), oauthUrlConstructible: constructible, requiredPermissions: ["pages_show_list", "pages_read_engagement", "pages_manage_metadata", "pages_messaging"] } };
}
