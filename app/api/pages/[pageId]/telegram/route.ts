import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { setPageTelegramDestination } from "@/services/telegram/service";

export async function POST(request: Request, { params }: { params: Promise<{ pageId: string }> }) {
  const admin = await requireAdmin();
  const pageId = (await params).pageId;
  const parsed = z.object({ botToken: z.string().trim().min(10).max(300), chatId: z.string().trim().min(1).max(120), enabled: z.boolean() }).safeParse(await request.json());
  if (!z.string().uuid().safeParse(pageId).success || !parsed.success) return NextResponse.json({ error: "Invalid Telegram configuration." }, { status: 400 });
  await setPageTelegramDestination({ pageId, ...parsed.data }, admin.id);
  return NextResponse.json({ ok: true });
}
