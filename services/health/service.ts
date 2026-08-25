import { prisma } from "@/lib/db/prisma";
import { getTelegramDestination } from "@/services/telegram/service";
import { isDevPreview } from "@/lib/env";
import { getPreviewAiSettings } from "@/services/preview/store";
import { getMetaPlatformConfig } from "@/services/meta/settings";
import { resolvePageId } from "@/services/pages/queries";

export type HealthState = "HEALTHY" | "DEGRADED" | "ACTION_REQUIRED" | "PAUSED";
export type HealthResult = { component: string; state: HealthState; detail: string };

export async function getSystemHealth(pageId?: string): Promise<HealthResult[]> {
  const results: HealthResult[] = [];
  if (isDevPreview()) {
    const ai = pageId ? getPreviewAiSettings(pageId) : null;
    const aiDetail = pageId ? (ai?.apiKeyConfigured ? "This Page's DeepSeek account is configured." : "This Page's DeepSeek account is not configured.") : "Provider credentials are checked per Page.";
    const aiState = pageId ? (ai?.apiKeyConfigured ? "HEALTHY" : "ACTION_REQUIRED") : "HEALTHY";
    const base = [{ component: "Meta", state: "HEALTHY" as const, detail: "Mock Facebook connection is active for local preview." }, { component: "DeepSeek", state: aiState as HealthState, detail: aiDetail }, { component: "Telegram", state: "DEGRADED" as const, detail: "Telegram credentials are configured per Page." }, { component: "Database", state: "HEALTHY" as const, detail: "Local preview fixtures are active; PostgreSQL is not required." }, { component: "Worker", state: "HEALTHY" as const, detail: "Local preview worker boundary is mocked." }];
    return base;
  }
  if (pageId) {
    const resolvedPageId = await resolvePageId(pageId);
    const page = resolvedPageId ? await prisma.page.findUnique({ where: { id: resolvedPageId }, include: { connection: true, aiSettings: true, telegramSettings: true } }) : null;
    const metaVerified = page?.connectionStatus === "CONNECTED" && page.connection?.lastHealthCheckStatus === "healthy";
    results.push({ component: "Meta", state: metaVerified ? "HEALTHY" : page?.connectionStatus === "CONNECTED" ? "DEGRADED" : "ACTION_REQUIRED", detail: metaVerified ? "Facebook Page connection was verified successfully." : page?.connectionStatus === "CONNECTED" ? "Facebook credentials exist but the last verification is missing or degraded." : "Facebook Page connection requires attention." });
    const paused = page?.aiStatus === "PAUSED_BY_BUDGET" || !page?.aiEnabled;
    const aiVerified = Boolean(page?.aiSettings?.encryptedApiKey && page.aiSettings.lastSuccessfulCallAt && !page.aiSettings.lastError);
    results.push({ component: "DeepSeek", state: paused ? "PAUSED" : aiVerified ? "HEALTHY" : page?.aiSettings?.encryptedApiKey ? "DEGRADED" : "ACTION_REQUIRED", detail: paused ? "AI is paused for this Page." : aiVerified ? "This Page's provider credentials completed a successful test/call." : page?.aiSettings?.encryptedApiKey ? "Provider credentials exist but have not been verified successfully." : "DeepSeek API key is not configured for this Page." });
    let telegramConfigured = false;
    try { telegramConfigured = Boolean(resolvedPageId && await getTelegramDestination(resolvedPageId)); } catch { telegramConfigured = false; }
    const telegramVerified = Boolean(telegramConfigured && page?.telegramSettings?.status === "CONNECTED" && page.telegramSettings.lastTestAt && !page.telegramSettings.lastError);
    results.push({ component: "Telegram", state: telegramVerified ? "HEALTHY" : telegramConfigured ? "DEGRADED" : "ACTION_REQUIRED", detail: telegramVerified ? "This Page's Telegram destination was verified successfully." : telegramConfigured ? "Telegram credentials exist but the last verification is missing or degraded." : "Telegram notifications are not configured for this Page." });
  } else {
    const meta = await getMetaPlatformConfig();
    const configured = Boolean(meta.appId && meta.appSecret && meta.verifyToken);
    results.push({ component: "Meta", state: configured ? "DEGRADED" : "ACTION_REQUIRED", detail: configured ? "Meta application settings are configured; Page verification is reported per Page." : "Meta application credentials are not configured." });
    results.push({ component: "DeepSeek", state: "HEALTHY", detail: "Provider credentials are checked per Page." });
    results.push({ component: "Telegram", state: "HEALTHY", detail: "Telegram credentials are checked per Page." });
  }
  try { await prisma.$queryRaw`SELECT 1`; results.push({ component: "Database", state: "HEALTHY", detail: "PostgreSQL is reachable." }); } catch { results.push({ component: "Database", state: "ACTION_REQUIRED", detail: "PostgreSQL is not reachable." }); }
  try { await prisma.job.findFirst({ where: { status: "RUNNING" }, select: { id: true } }); results.push({ component: "Worker", state: "HEALTHY", detail: "Worker queue is available." }); } catch { results.push({ component: "Worker", state: "DEGRADED", detail: "Worker queue could not be checked." }); }
  return results;
}

export async function runSystemTest(input: { pageId?: string; component?: string }) {
  const health = await getSystemHealth(input.pageId);
  const component = input.component?.toLowerCase();
  const results = component ? health.filter((item) => item.component.toLowerCase() === component) : health;
  return { results, mocked: true, note: "Local system tests use configured-state mocks; live provider checks remain external." };
}
