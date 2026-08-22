import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { healthCheckMetaPage } from "@/services/meta/service";
import { z } from "zod";
import { isSameOrigin } from "@/lib/auth/csrf";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 });
  await requireAdmin(); const parsed = z.object({ pageId: z.string().uuid() }).safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid Page." }, { status: 400 });
  try { const identity = await healthCheckMetaPage(parsed.data.pageId); return NextResponse.json({ ok: true, identity }); } catch { return NextResponse.json({ error: "Meta connection health check failed." }, { status: 502 }); }
}
