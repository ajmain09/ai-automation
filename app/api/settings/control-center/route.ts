import { NextResponse } from "next/server";
import { z } from "zod";
import { isSameOrigin } from "@/lib/auth/csrf";
import { requireAdmin } from "@/lib/auth/session";
import { isDevPreview } from "@/lib/env";
import { getPreviewControlCenter, refreshPreviewBalance, testPreviewMeta, updatePreviewAiProvider, updatePreviewFxRate, updatePreviewGlobalBudget, updatePreviewMeta, updatePreviewPricing, updatePreviewTelegram } from "@/services/preview/store";

const inputSchema = z.object({
  section: z.enum(["meta", "ai", "telegram", "fx", "pricing", "globalBudget", "testMeta", "refreshBalance"]),
  appId: z.string().trim().max(200).optional(), appSecret: z.string().trim().max(500).optional(), verifyToken: z.string().trim().max(500).optional(), graphApiVersion: z.string().trim().max(20).optional(),
  apiKey: z.string().trim().max(500).optional(), defaultModel: z.enum(["deepseek-v4-flash", "deepseek-v4-pro"]).optional(), thinkingMode: z.enum(["off", "on"]).optional(), maxOutputTokens: z.number().int().min(100).max(8000).optional(), timeoutMs: z.number().int().min(1000).max(120000).optional(), retryCount: z.number().int().min(0).max(5).optional(),
  chatId: z.string().trim().max(120).optional(), token: z.string().trim().max(500).optional(),
  rate: z.number().positive().optional(), model: z.enum(["deepseek-v4-flash", "deepseek-v4-pro"]).optional(), inputCacheHitUsd: z.number().nonnegative().optional(), inputCacheMissUsd: z.number().nonnegative().optional(), outputUsd: z.number().nonnegative().optional(),
  monthlyBdt: z.number().nonnegative().nullable().optional(), dailyBdt: z.number().nonnegative().nullable().optional(), hardLimit: z.boolean().optional(), warningThreshold: z.number().int().min(1).max(100).optional(),
});

export async function GET() {
  await requireAdmin();
  if (!isDevPreview()) return NextResponse.json({ error: "Control Center requires the configured database runtime." }, { status: 501 });
  return NextResponse.json({ control: getPreviewControlCenter() });
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 });
  await requireAdmin();
  if (!isDevPreview()) return NextResponse.json({ error: "Control Center persistence requires the configured database runtime." }, { status: 501 });
  const parsed = inputSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Check the control center fields." }, { status: 400 });
  const input = parsed.data;
  if (input.section === "meta") updatePreviewMeta({ appId: input.appId ?? "", appSecret: input.appSecret, verifyToken: input.verifyToken, graphApiVersion: input.graphApiVersion });
  if (input.section === "testMeta") testPreviewMeta();
  if (input.section === "ai") updatePreviewAiProvider({ apiKey: input.apiKey, defaultModel: input.defaultModel, thinkingMode: input.thinkingMode, maxOutputTokens: input.maxOutputTokens, timeoutMs: input.timeoutMs, retryCount: input.retryCount });
  if (input.section === "refreshBalance") refreshPreviewBalance();
  if (input.section === "telegram") updatePreviewTelegram({ token: input.token, chatId: input.chatId ?? "" });
  if (input.section === "fx") { if (input.rate === undefined) return NextResponse.json({ error: "FX rate is required." }, { status: 400 }); updatePreviewFxRate(input.rate); }
  if (input.section === "pricing") { if (!input.model || input.inputCacheHitUsd === undefined || input.inputCacheMissUsd === undefined || input.outputUsd === undefined) return NextResponse.json({ error: "Complete the pricing profile." }, { status: 400 }); updatePreviewPricing({ model: input.model, inputCacheHitUsd: input.inputCacheHitUsd, inputCacheMissUsd: input.inputCacheMissUsd, outputUsd: input.outputUsd }); }
  if (input.section === "globalBudget") updatePreviewGlobalBudget({ monthlyBdt: input.monthlyBdt ?? null, dailyBdt: input.dailyBdt ?? null, hardLimit: input.hardLimit ?? false, warningThreshold: input.warningThreshold ?? 85 });
  return NextResponse.json({ ok: true, control: getPreviewControlCenter() });
}
