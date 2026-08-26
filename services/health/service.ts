import { prisma } from "@/lib/db/prisma";
import { getTelegramDestination } from "@/services/telegram/service";
import { isDevPreview } from "@/lib/env";
import { getPreviewAiSettings } from "@/services/preview/store";
import { getMetaPlatformConfig } from "@/services/meta/settings";
import { resolvePageId } from "@/services/pages/queries";

export type HealthState = "HEALTHY" | "DEGRADED" | "ACTION_REQUIRED" | "PAUSED";
export type HealthResult = { component: string; state: HealthState; detail: string };
export const WORKER_HEALTH_THRESHOLDS_SECONDS = { healthy: 90, stale: 300 } as const;
export function workerHealthState(ageSeconds: number) { return ageSeconds <= WORKER_HEALTH_THRESHOLDS_SECONDS.healthy ? "HEALTHY" : ageSeconds <= WORKER_HEALTH_THRESHOLDS_SECONDS.stale ? "STALE" : "DOWN" as const; }

export async function getOperationalHealth() {
  const checkedAt = new Date();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const [heartbeats, pending, running, deadLetter, oldest, webhook, telegram, telegramLast, openIssues, highIssues] = await Promise.all([
      prisma.workerHeartbeat.findMany({ orderBy: { lastHeartbeatAt: "desc" } }),
      prisma.job.count({ where: { status: "PENDING" } }),
      prisma.job.count({ where: { status: "RUNNING" } }),
      prisma.job.count({ where: { status: "DEAD_LETTER" } }),
      prisma.job.findFirst({ where: { status: "PENDING" }, orderBy: { runAt: "asc" }, select: { runAt: true } }),
      prisma.webhookEvent.findFirst({ where: { signatureValid: true }, orderBy: { receivedAt: "desc" }, select: { receivedAt: true, pageId: true } }),
      prisma.deliveryOutbox.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.deliveryOutbox.findFirst({ where: { status: "SENT" }, orderBy: { sentAt: "desc" }, select: { sentAt: true } }),
      prisma.issue.count({ where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } } }),
      prisma.issue.count({ where: { status: { in: ["OPEN", "ACKNOWLEDGED"] }, severity: "high" } }),
    ]);
    const now = checkedAt.getTime();
    const workers = heartbeats.map((heartbeat) => { const age = Math.max(0, (now - heartbeat.lastHeartbeatAt.getTime()) / 1000); return { workerId: heartbeat.workerId, startedAt: heartbeat.startedAt, lastHeartbeatAt: heartbeat.lastHeartbeatAt, state: workerHealthState(age), ageSeconds: Math.round(age) }; });
    const workerState = workers.some((item) => item.state === "HEALTHY") ? "HEALTHY" : workers.some((item) => item.state === "STALE") ? "STALE" : "DOWN";
    const telegramCount = (status: string) => telegram.find((item) => item.status === status)?._count._all ?? 0;
    return { checkedAt, application: { state: "HEALTHY", alive: true }, database: { state: "HEALTHY", reachable: true }, worker: { state: workerState, workers }, queue: { state: deadLetter > 0 ? "DEGRADED" : "HEALTHY", pending, running, deadLetter, oldestPendingAt: oldest?.runAt ?? null, oldestPendingAgeSeconds: oldest ? Math.max(0, Math.round((now - oldest.runAt.getTime()) / 1000)) : 0 }, webhook: { state: webhook ? "ACTIVE" : "INACTIVE", lastValidReceivedAt: webhook?.receivedAt ?? null, pageId: webhook?.pageId ?? null }, telegram: { state: telegramCount("FAILED_PERMANENT") + telegramCount("DEAD_LETTER") > 0 ? "DEGRADED" : "HEALTHY", pending: telegramCount("PENDING") + telegramCount("SENDING"), failedRetryable: telegramCount("FAILED_RETRYABLE"), failedPermanent: telegramCount("FAILED_PERMANENT"), deadLetter: telegramCount("DEAD_LETTER"), lastSuccessfulDeliveryAt: telegramLast?.sentAt ?? null }, issues: { state: highIssues > 0 ? "ACTION_REQUIRED" : openIssues > 0 ? "DEGRADED" : "HEALTHY", open: openIssues, highSeverityOpen: highIssues } };
  } catch { return { checkedAt, application: { state: "HEALTHY", alive: true }, database: { state: "ACTION_REQUIRED", reachable: false }, worker: { state: "DOWN", workers: [] }, queue: { state: "UNKNOWN", pending: 0, running: 0, deadLetter: 0, oldestPendingAt: null, oldestPendingAgeSeconds: 0 }, webhook: { state: "UNKNOWN", lastValidReceivedAt: null, pageId: null }, telegram: { state: "UNKNOWN", pending: 0, failedRetryable: 0, failedPermanent: 0, deadLetter: 0, lastSuccessfulDeliveryAt: null }, issues: { state: "UNKNOWN", open: 0, highSeverityOpen: 0 } };
  }
}

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
