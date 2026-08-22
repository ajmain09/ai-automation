import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { setGlobalTelegramDestination } from "@/services/telegram/service";

export async function POST(request: Request) {
  const admin = await requireAdmin();
  const parsed = z.object({ botToken: z.string().trim().min(10).max(300), chatId: z.string().trim().min(1).max(120) }).safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid Telegram configuration." }, { status: 400 });
  await setGlobalTelegramDestination(parsed.data, admin.id);
  return NextResponse.json({ ok: true });
}
