import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { isSameOrigin } from "@/lib/auth/csrf";
import { isDevPreview } from "@/lib/env";
import { getPreviewAiSettings, getPreviewPage, refreshPreviewPageBalance, testPreviewAiCredential, updatePreviewAiSettings } from "@/services/preview/store";
import { prisma } from "@/lib/db/prisma";
import { encryptCredential } from "@/lib/encryption/service";
import { DeepSeekProvider } from "@/services/ai/provider";

const settingsSchema = z.object({
  action: z.enum(["save", "testCredential", "refreshBalance"]).default("save"),
  language: z.enum(["auto", "bangla", "banglish", "english"]).optional(),
  tone: z.enum(["natural_sales", "friendly", "formal", "concise"]).optional(),
  replyLength: z.enum(["short", "medium"]).optional(),
  understandBeforeRecommend: z.boolean().optional(),
  maxProductsPerRecommendation: z.union([z.literal(1), z.literal(2)]).optional(),
  suggestCombo: z.boolean().optional(),
  askOneQuestionAtATime: z.boolean().optional(),
  mirrorCustomerLanguage: z.boolean().optional(),
  customerMemory: z.boolean().optional(),
  recentMessageContext: z.number().int().min(10).max(20).optional(),
  rollingSummary: z.boolean().optional(),
  smartBuffer: z.boolean().optional(),
  bufferWindowSeconds: z.number().int().min(3).max(30).optional(),
  manualCollisionProtection: z.boolean().optional(),
  manualActivityCooldownSeconds: z.number().int().min(10).max(120).optional(),
  customSalesInstructions: z.string().max(5000).optional(),
  modelOverride: z.enum(["master", "deepseek-v4-flash", "deepseek-v4-pro"]).optional(),
  thinking: z.enum(["master", "off", "on"]).optional(),
  maxOutputTokens: z.number().int().min(100).max(8000).optional(),
  apiKey: z.string().trim().max(500).optional(),
});

export async function GET(_request: Request, { params }: { params: Promise<{ pageId: string }> }) {
  await requireAdmin();
  const { pageId } = await params;
  if (isDevPreview()) { if (!getPreviewPage(pageId)) return NextResponse.json({ error: "Page not found." }, { status: 404 }); return NextResponse.json({ settings: getPreviewAiSettings(pageId) }); }
  const page = await prisma.page.findFirst({ where: { OR: [{ id: pageId }, { slug: pageId }] }, include: { aiSettings: true } });
  if (!page) return NextResponse.json({ error: "Page not found." }, { status: 404 });
  const settings = page.aiSettings;
  return NextResponse.json({ settings: { ...(settings ?? {}), apiKey: undefined, apiKeyConfigured: Boolean(settings?.encryptedApiKey), accountLabel: "Page DeepSeek account", providerBalanceUsd: settings?.providerBalanceUsd ? Number(settings.providerBalanceUsd) : null, providerBalanceCny: settings?.providerBalanceCny ? Number(settings.providerBalanceCny) : null, lastBalanceAt: settings?.lastBalanceCheckAt ?? null, modelOverride: settings?.model ?? "deepseek-v4-flash", thinking: settings?.thinkingOverride ?? "off", manualActivityCooldownSeconds: settings?.manualActivityCooldown ?? 30, maxProductsPerRecommendation: settings?.maxProductsPerRecommendation ?? 1, avoidRepeatedQuestions: true, staleReplyProtection: true, sequentialProcessing: true } });
}

export async function POST(request: Request, { params }: { params: Promise<{ pageId: string }> }) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 });
  const admin = await requireAdmin();
  const { pageId } = await params;
  const parsed = settingsSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Check the AI settings and try again." }, { status: 400 });
  if (isDevPreview()) { if (!getPreviewPage(pageId)) return NextResponse.json({ error: "Page not found." }, { status: 404 }); if (parsed.data.action === "refreshBalance") return NextResponse.json({ ok: true, settings: refreshPreviewPageBalance(pageId) }); if (parsed.data.action === "testCredential") { const result = testPreviewAiCredential(pageId, parsed.data.apiKey); return result.ok ? NextResponse.json({ ok: true, settings: result.settings }) : NextResponse.json({ error: result.error }, { status: 422 }); } return NextResponse.json({ ok: true, settings: updatePreviewAiSettings(pageId, parsed.data) }); }
  if (parsed.data.action === "refreshBalance") return NextResponse.json({ error: "Provider balance checks are deferred until the live provider connector is enabled." }, { status: 501 });
  const page = await prisma.page.findFirst({ where: { OR: [{ id: pageId }, { slug: pageId }] }, select: { id: true } });
  if (!page) return NextResponse.json({ error: "Page not found." }, { status: 404 });
  const { action, apiKey, modelOverride, thinking, manualActivityCooldownSeconds, ...rest } = parsed.data;
  if (action === "testCredential") {
    const current = await prisma.pageAiSettings.findUnique({ where: { pageId: page.id }, select: { encryptedApiKey: true, baseUrl: true, model: true } });
    const key = apiKey?.trim();
    if (!key) return NextResponse.json({ error: "Enter the Page provider credential to test." }, { status: 400 });
    try {
      const provider = new DeepSeekProvider(key, current?.baseUrl, modelOverride && modelOverride !== "master" ? modelOverride : current?.model, page.id);
      await provider.complete({ system: "Return a valid JSON object with an ok boolean.", user: JSON.stringify({ ok: true }), callType: "PRELIVE_TEST" });
      const settings = await prisma.pageAiSettings.upsert({ where: { pageId: page.id }, update: { encryptedApiKey: encryptCredential(key), status: "CONNECTED", lastSuccessfulCallAt: new Date(), lastError: null }, create: { pageId: page.id, encryptedApiKey: encryptCredential(key), status: "CONNECTED", lastSuccessfulCallAt: new Date() } });
      return NextResponse.json({ ok: true, settings: { ...settings, encryptedApiKey: undefined, apiKeyConfigured: true } });
    } catch { await prisma.pageAiSettings.updateMany({ where: { pageId: page.id }, data: { status: "ERROR", lastFailedCallAt: new Date(), lastError: "DeepSeek credential validation failed." } }); return NextResponse.json({ error: "DeepSeek rejected this Page credential." }, { status: 422 }); }
  }
  const settings = await prisma.$transaction(async (tx) => {
    const value = await tx.pageAiSettings.upsert({ where: { pageId: page.id }, update: { ...rest, ...(apiKey?.trim() ? { encryptedApiKey: encryptCredential(apiKey), status: "CONNECTED" } : {}), ...(modelOverride ? { model: modelOverride === "master" ? "deepseek-v4-flash" : modelOverride } : {}), ...(thinking ? { thinkingOverride: thinking === "master" ? null : thinking } : {}), ...(manualActivityCooldownSeconds !== undefined ? { manualActivityCooldown: manualActivityCooldownSeconds } : {}) }, create: { pageId: page.id, ...rest, ...(apiKey?.trim() ? { encryptedApiKey: encryptCredential(apiKey) } : {}), ...(modelOverride && modelOverride !== "master" ? { model: modelOverride } : {}), ...(thinking && thinking !== "master" ? { thinkingOverride: thinking } : {}), ...(manualActivityCooldownSeconds !== undefined ? { manualActivityCooldown: manualActivityCooldownSeconds } : {}), status: apiKey?.trim() ? "CONNECTED" : "NOT_CONFIGURED" } });
    await tx.auditLog.create({ data: { adminId: admin.id, pageId: page.id, action: "ai.page_configuration_changed" } });
    return value;
  });
  return NextResponse.json({ ok: true, settings: { ...settings, encryptedApiKey: undefined, apiKeyConfigured: Boolean(settings.encryptedApiKey), modelOverride: settings.model, thinking: settings.thinkingOverride ?? "off" } });
}
