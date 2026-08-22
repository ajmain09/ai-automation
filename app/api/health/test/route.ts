import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { isSameOrigin } from "@/lib/auth/csrf";
import { runSystemTest } from "@/services/health/service";

export async function POST(request: Request) {
  await requireAdmin();
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 });
  const parsed = z.object({ pageId: z.string().uuid().optional(), component: z.enum(["Meta", "DeepSeek", "Telegram", "Database", "Worker"]).optional() }).safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid system test." }, { status: 400 });
  return NextResponse.json(await runSystemTest(parsed.data));
}
