import { prisma } from "@/lib/db/prisma";
import { isDevPreview } from "@/lib/env";
import { getPreviewAiSettings, getPreviewPage, setPreviewLive } from "@/services/preview/store";
import { resolvePageId } from "@/services/pages/queries";
import { publishLatestDraft } from "@/services/configuration/service";
import { checkFacebookTransport } from "@/services/meta/runtime-gate";
import { validatePageProductTruth } from "@/services/products/retrieval";

export function evaluateMemoryReadiness(enabled: boolean, persistenceQuerySucceeded: boolean) { return enabled ? { ok: persistenceQuerySucceeded, detail: persistenceQuerySucceeded ? "Page-scoped customer memory persistence is available." : "Page-scoped customer memory persistence is unavailable." } : { ok: true, detail: "Customer memory is disabled for this Page." }; }

export type ReadinessCheck = { key: string; label: string; ok: boolean; detail: string };
export type PageReadiness = { ready: boolean; checks: ReadinessCheck[] };

export async function checkPageReadiness(pageId: string): Promise<PageReadiness> {
  if (isDevPreview()) {
    const page = getPreviewPage(pageId);
    if (!page) throw new Error("Page not found");
    const aiConfigured = !page.aiEnabled || getPreviewAiSettings(pageId).apiKeyConfigured;
    const requiredOrderFields = page.settings?.requiredOrderFields;
    const checks: ReadinessCheck[] = [
      { key: "facebook", label: "Facebook connection", ok: checkFacebookTransport(page).ok, detail: "Mock Facebook connection is active in local preview." },
      { key: "live_config", label: "Live business configuration", ok: Boolean(page.configurationVersions.some((item) => item.status === "LIVE") || page.configurationVersions.some((item) => item.status === "DRAFT")), detail: "A validated business configuration is required before go-live." },
      { key: "conflicts", label: "Critical conflicts", ok: true, detail: "No fixture conflicts are present." },
      { key: "products", label: "Active product catalog", ok: page.products.some((product) => product.variants.length > 0), detail: "At least one active product with an active variant is required." },
      { key: "ai_config", label: "AI configuration", ok: aiConfigured, detail: aiConfigured ? "DeepSeek is configured." : "DeepSeek not configured." },
      { key: "memory", label: "Memory system", ok: true, detail: "Page-scoped memory storage is mocked for preview." },
      { key: "validation", label: "Product validation", ok: true, detail: "Canonical Page product validation is mocked for preview." },
      { key: "order_settings", label: "Order settings", ok: Array.isArray(requiredOrderFields) && requiredOrderFields.length > 0, detail: "Required order fields must be configured." },
      { key: "telegram", label: "Telegram notifications", ok: true, detail: "Telegram is not used by local preview." },
      { key: "page_ai", label: "Page AI availability", ok: !page.aiEnabled || page.aiStatus !== "PAUSED_BY_BUDGET", detail: "Only this Page's AI budget state affects readiness." },
    ];
    return { ready: checks.every((check) => check.ok), checks };
  }
  const resolvedPageId = await resolvePageId(pageId);
  const page = resolvedPageId ? await prisma.page.findUnique({ where: { id: resolvedPageId }, include: { connection: true, settings: true, aiSettings: true, telegramSettings: true, configurationVersions: { where: { status: "LIVE" }, take: 1 }, products: { where: { active: true }, include: { variants: { where: { active: true } } } } } }) : null;
  if (!page) throw new Error("Page not found");
  const live = page.configurationVersions[0];
  const data = live?.businessData as { conflicts?: Array<{ critical?: boolean }> } | null | undefined;
  const productTruth = await validatePageProductTruth(page.id);
  let memoryReady = true;
  let memoryDetail = "Customer memory is disabled for this Page.";
  if (page.aiSettings?.customerMemory !== false) {
    try { await prisma.$queryRaw`SELECT "id" FROM "CustomerMemory" WHERE "customerId" IN (SELECT "id" FROM "Customer" WHERE "pageId" = ${page.id}::uuid) LIMIT 1`; ({ ok: memoryReady, detail: memoryDetail } = evaluateMemoryReadiness(true, true)); }
    catch { ({ ok: memoryReady, detail: memoryDetail } = evaluateMemoryReadiness(true, false)); }
  }
  const checks: ReadinessCheck[] = [
    { key: "facebook", label: "Facebook connection", ok: checkFacebookTransport(page).ok, detail: "A usable Meta Page connection with matching Page and PageConnection status is required." },
    { key: "live_config", label: "Live business configuration", ok: Boolean(live), detail: "A validated LIVE configuration is required." },
    { key: "conflicts", label: "Critical conflicts", ok: !data?.conflicts?.some((item) => item.critical), detail: "Critical business conflicts must be resolved." },
    { key: "products", label: "Active product catalog", ok: page.products.some((product) => product.variants.length > 0), detail: "At least one active product with an active variant is required." },
    { key: "ai_config", label: "AI configuration", ok: !page.aiEnabled || Boolean(page.aiSettings?.encryptedApiKey && page.aiSettings.status === "CONNECTED"), detail: "This Page must have its own successfully tested AI provider key when AI is enabled." },
    { key: "memory", label: "Memory system", ok: memoryReady, detail: memoryDetail },
    { key: "validation", label: "Product validation", ok: productTruth.ok, detail: productTruth.detail },
    { key: "order_settings", label: "Order settings", ok: Array.isArray(page.settings?.requiredOrderFields) && page.settings.requiredOrderFields.length > 0, detail: "Required order fields must be configured." },
    { key: "telegram", label: "Telegram notifications", ok: !page.telegramSettings || (!page.telegramSettings.encryptedBotToken && !page.telegramSettings.chatId) || page.telegramSettings.status === "CONNECTED", detail: "Telegram is optional; configured credentials and destinations must be successfully tested." },
  ];
  checks.push({ key: "page_ai", label: "Page AI availability", ok: page.aiStatus !== "PAUSED_BY_BUDGET", detail: "Only this Page's budget state can pause its AI." });
  return { ready: checks.every((check) => check.ok), checks };
}

export async function setPageLive(pageId: string, adminId: string) {
  if (isDevPreview()) {
    const readiness = await checkPageReadiness(pageId);
    if (!readiness.ready) throw new Error(`Page is not ready: ${readiness.checks.filter((check) => !check.ok).map((check) => check.key).join(", ")}`);
    return setPreviewLive(pageId);
  }
  const resolvedBeforePublish = await resolvePageId(pageId);
  if (!resolvedBeforePublish) throw new Error("Page not found");
  const draft = await prisma.configurationVersion.findFirst({ where: { pageId: resolvedBeforePublish, status: "DRAFT" }, select: { id: true } });
  if (draft) await publishLatestDraft(resolvedBeforePublish, adminId);
  const readiness = await checkPageReadiness(resolvedBeforePublish);
  if (!readiness.ready) throw new Error(`Page is not ready: ${readiness.checks.filter((check) => !check.ok).map((check) => check.key).join(", ")}`);
  const resolvedPageId = resolvedBeforePublish;
  return prisma.$transaction(async (tx) => {
    const page = await tx.page.update({ where: { id: resolvedPageId }, data: { lifecycleStatus: "LIVE", readinessCheckedAt: new Date() } });
    await tx.auditLog.create({ data: { adminId, pageId: resolvedPageId, action: "page.went_live" } });
    return page;
  });
}
