import { prisma } from "@/lib/db/prisma";
import { getEnv } from "@/lib/env";
import { getTelegramDestination } from "@/services/telegram/service";

export type HealthState = "HEALTHY" | "DEGRADED" | "ACTION_REQUIRED" | "PAUSED";
export type HealthResult = { component: string; state: HealthState; detail: string };

export async function getSystemHealth(pageId?: string): Promise<HealthResult[]> {
  const env = getEnv();
  const results: HealthResult[] = [];
  if (pageId) {
    const page = await prisma.page.findUnique({ where: { id: pageId }, include: { connection: true, settings: true } });
    results.push({ component: "Meta", state: page?.connectionStatus === "CONNECTED" ? "HEALTHY" : "ACTION_REQUIRED", detail: page?.connectionStatus === "CONNECTED" ? "Facebook Page connection is usable." : "Facebook Page connection requires attention." });
    const paused = page?.settings?.globalAiPaused || !page?.aiEnabled;
    results.push({ component: "DeepSeek", state: paused ? "PAUSED" : env.DEEPSEEK_API_KEY ? "HEALTHY" : "ACTION_REQUIRED", detail: paused ? "AI is paused for this Page." : env.DEEPSEEK_API_KEY ? "Provider credentials are configured." : "DeepSeek API key is not configured." });
    let telegramConfigured = false;
    try { telegramConfigured = Boolean(await getTelegramDestination(pageId)); } catch { telegramConfigured = false; }
    results.push({ component: "Telegram", state: page?.settings?.telegramEnabled && !telegramConfigured ? "ACTION_REQUIRED" : telegramConfigured ? "HEALTHY" : "DEGRADED", detail: telegramConfigured ? "A Telegram destination is configured." : "Telegram notifications are not configured." });
  } else {
    results.push({ component: "Meta", state: env.META_APP_ID && env.META_APP_SECRET && env.META_REDIRECT_URI ? "HEALTHY" : "ACTION_REQUIRED", detail: env.META_APP_ID && env.META_APP_SECRET && env.META_REDIRECT_URI ? "Meta application settings are configured." : "Meta application credentials are not configured." });
    results.push({ component: "DeepSeek", state: env.DEEPSEEK_API_KEY ? "HEALTHY" : "ACTION_REQUIRED", detail: env.DEEPSEEK_API_KEY ? "DeepSeek credentials are configured." : "DeepSeek API key is not configured." });
    const telegram = await prisma.systemSetting.findUnique({ where: { key: "telegram_global_destination" } });
    results.push({ component: "Telegram", state: telegram ? "HEALTHY" : "DEGRADED", detail: telegram ? "Global Telegram destination is configured." : "Global Telegram destination is not configured." });
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
