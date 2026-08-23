import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { setGlobalTelegramDestination } from "@/services/telegram/service";
import { isSameOrigin } from "@/lib/auth/csrf";
import { isDevPreview } from "@/lib/env";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 });
  const admin = await requireAdmin();
  const parsed = z.object({ botToken: z.string().trim().min(10).max(300), chatId: z.string().trim().min(1).max(120) }).safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid Telegram configuration." }, { status: 400 });
  if (isDevPreview()) return NextResponse.json({ ok: true, mocked: true });
  await setGlobalTelegramDestination(parsed.data, admin.id);
  return NextResponse.json({ ok: true });
}
