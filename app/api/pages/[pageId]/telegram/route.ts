import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { getPageTelegramSettings, setPageTelegramDestination } from "@/services/telegram/service";
import { isSameOrigin } from "@/lib/auth/csrf";
import { isDevPreview } from "@/lib/env";
import { getPreviewPage, getPreviewTelegramSettings, testPreviewTelegram, updatePreviewTelegramSettings } from "@/services/preview/store";
import { resolvePageId } from "@/services/pages/queries";

const schema = z.object({ action: z.enum(["save", "test"]).default("save"), botToken: z.string().trim().max(300).optional(), chatId: z.string().trim().min(1).max(120), newOrderEnabled: z.boolean(), updatedOrderEnabled: z.boolean(), cancelledOrderEnabled: z.boolean() });

export async function GET(_request: Request, { params }: { params: Promise<{ pageId: string }> }) {
  await requireAdmin();
  const pageId = (await params).pageId;
  if (isDevPreview()) { if (!getPreviewPage(pageId)) return NextResponse.json({ error: "Page not found." }, { status: 404 }); return NextResponse.json({ settings: getPreviewTelegramSettings(pageId) }); }
  const resolvedPageId = await resolvePageId(pageId);
  if (!resolvedPageId) return NextResponse.json({ error: "Page not found." }, { status: 404 });
  return NextResponse.json({ settings: await getPageTelegramSettings(resolvedPageId) });
}

export async function POST(request: Request, { params }: { params: Promise<{ pageId: string }> }) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 });
  const admin = await requireAdmin();
  const pageId = (await params).pageId;
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid Telegram configuration." }, { status: 400 });
  if (isDevPreview()) { if (!getPreviewPage(pageId)) return NextResponse.json({ error: "Page not found." }, { status: 404 }); if (parsed.data.action === "test") { const settings = testPreviewTelegram(pageId, parsed.data.botToken, parsed.data.chatId); return settings.status === "CONNECTED" ? NextResponse.json({ ok: true, mocked: true, settings }) : NextResponse.json({ error: "Telegram test failed. Check the token and destination.", settings }, { status: 422 }); } return NextResponse.json({ ok: true, mocked: true, settings: updatePreviewTelegramSettings(pageId, parsed.data) }); }
  const resolvedPageId = await resolvePageId(pageId); if (!resolvedPageId) return NextResponse.json({ error: "Page not found." }, { status: 404 });
  await setPageTelegramDestination({ pageId: resolvedPageId, ...parsed.data }, admin.id);
  return NextResponse.json({ ok: true });
}
