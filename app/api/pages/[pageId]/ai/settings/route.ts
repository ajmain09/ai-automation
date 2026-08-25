import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { isSameOrigin } from "@/lib/auth/csrf";
import { isDevPreview } from "@/lib/env";
import { getPreviewAiSettings, getPreviewPage, updatePreviewAiSettings } from "@/services/preview/store";

const settingsSchema = z.object({
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
});

export async function GET(_request: Request, { params }: { params: Promise<{ pageId: string }> }) {
  await requireAdmin();
  const { pageId } = await params;
  if (!isDevPreview()) return NextResponse.json({ error: "AI settings are not available in this local build." }, { status: 404 });
  if (!getPreviewPage(pageId)) return NextResponse.json({ error: "Page not found." }, { status: 404 });
  return NextResponse.json({ settings: getPreviewAiSettings(pageId) });
}

export async function POST(request: Request, { params }: { params: Promise<{ pageId: string }> }) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 });
  await requireAdmin();
  const { pageId } = await params;
  if (!isDevPreview()) return NextResponse.json({ error: "AI settings persistence requires the configured database runtime." }, { status: 501 });
  if (!getPreviewPage(pageId)) return NextResponse.json({ error: "Page not found." }, { status: 404 });
  const parsed = settingsSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Check the AI settings and try again." }, { status: 400 });
  return NextResponse.json({ ok: true, settings: updatePreviewAiSettings(pageId, parsed.data) });
}
