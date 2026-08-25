import { canonicalUrls, getEnv } from "@/lib/env";
import { prisma } from "@/lib/db/prisma";
import { decryptCredential, encryptCredential } from "@/lib/encryption/service";

export type MetaPlatformConfig = {
  appId: string;
  appSecret: string;
  verifyToken: string;
  graphApiVersion: string;
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
    redirectUri: stored?.oauthRedirectUri || env.META_REDIRECT_URI || canonicalUrls.metaRedirect,
    webhookUrl: stored?.webhookUrl || env.META_WEBHOOK_URL || canonicalUrls.metaWebhook,
  };
}

export async function getMetaControlCenter() {
  const config = await getMetaPlatformConfig();
  const stored = await storedMetaSetting();
  const configured = Boolean(config.appId && config.appSecret && config.verifyToken);
  return {
    globalAiPaused: false,
    general: { applicationName: "Growthifyx AI Sales", canonicalDomain: canonicalUrls.app, currency: "BDT" as const, timezone: "Asia/Dhaka", country: "Bangladesh", language: "Auto" },
    meta: {
      appId: config.appId,
      appSecretConfigured: Boolean(config.appSecret),
      verifyTokenConfigured: Boolean(config.verifyToken),
      graphApiVersion: config.graphApiVersion,
      status: configured ? "READY" as const : "NOT_CONFIGURED" as const,
      lastError: stored?.lastError ?? null,
      lastTestAt: stored?.lastApiTestAt ?? null,
    },
  };
}

export async function saveMetaPlatformConfig(input: { appId: string; appSecret?: string; verifyToken?: string; graphApiVersion?: string }, adminId: string) {
  const current = await getMetaPlatformConfig();
  const appId = input.appId.trim();
  const appSecret = input.appSecret?.trim() || current.appSecret;
  const verifyToken = input.verifyToken?.trim() || current.verifyToken;
  const graphApiVersion = input.graphApiVersion?.trim() || current.graphApiVersion;
  const status = appId && appSecret && verifyToken ? "READY" : "DEGRADED";

  await prisma.$transaction(async (tx) => {
    const existing = await tx.metaPlatformSetting.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
    const data = {
      appId,
      appSecretEncrypted: appSecret ? encryptCredential(appSecret) : null,
      verifyTokenEncrypted: verifyToken ? encryptCredential(verifyToken) : null,
      graphApiVersion,
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
  const ready = Boolean(config.appId && config.appSecret && config.verifyToken);
  const error = ready ? null : "Configure the Meta App ID, App Secret, and Webhook Verify Token first.";
  const existing = await storedMetaSetting();
  if (existing) await prisma.metaPlatformSetting.update({ where: { id: existing.id }, data: { status: ready ? "READY" : "ERROR", lastApiTestAt: new Date(), lastError: error } });
  await prisma.auditLog.create({ data: { adminId, action: ready ? "meta.platform_configuration_tested" : "meta.platform_configuration_test_failed" } });
  return getMetaControlCenter();
}
