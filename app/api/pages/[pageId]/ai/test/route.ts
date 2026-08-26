import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { isSameOrigin } from "@/lib/auth/csrf";
import { isDevPreview } from "@/lib/env";
import { runPreviewAiTest } from "@/services/preview/store";
import { prisma } from "@/lib/db/prisma";
import { createPageDeepSeekProvider, fallbackAiResponse, runStructuredAi } from "@/services/ai/provider";
import { aiResponseSchema } from "@/lib/validation/ai";
import { emptyMemory } from "@/services/memory/service";

export async function POST(request: Request, { params }: { params: Promise<{ pageId: string }> }) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 });
  await requireAdmin();
  const parsed = z.object({ message: z.string().trim().min(1).max(2000) }).safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Enter a customer message first." }, { status: 400 });
  try {
    const pageId = (await params).pageId;
    if (isDevPreview()) return NextResponse.json({ ok: true, result: runPreviewAiTest(pageId, parsed.data.message) });
    const page = await prisma.page.findFirst({ where: { OR: [{ id: pageId }, { slug: pageId }] }, include: { settings: true, businessProfile: true, products: { where: { active: true }, include: { variants: { where: { active: true } } }, take: 20 } } });
    if (!page) return NextResponse.json({ error: "Page not found." }, { status: 404 });
    const provider = await createPageDeepSeekProvider(page.id);
    const result = await runStructuredAi({ pageId: page.id, provider, callType: "PRELIVE_TEST", system: "You are testing one Facebook Page's configured sales assistant. Never send a message. Return only the requested JSON schema and never invent catalog or policy facts.", user: JSON.stringify({ message: parsed.data.message, settings: page.settings, business: page.businessProfile, products: page.products, memory: emptyMemory() }), schema: aiResponseSchema, fallback: fallbackAiResponse() });
    return NextResponse.json({ ok: true, result, sent: false });
  }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to run the AI test." }, { status: 400 }); }
}
