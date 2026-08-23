import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { setPageLive } from "@/services/pages/readiness";
import { z } from "zod";
import { isSameOrigin } from "@/lib/auth/csrf";
import { isDevPreview } from "@/lib/env";
import { setPreviewLive } from "@/services/preview/store";

export async function POST(_request: Request, { params }: { params: Promise<{ pageId: string }> }) {
  if (!isSameOrigin(_request)) return NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 });
  const admin = await requireAdmin();
  const pageId = (await params).pageId;
  if (!z.string().uuid().safeParse(pageId).success) return NextResponse.json({ error: "Invalid Page." }, { status: 400 });
  if (isDevPreview()) { if (!setPreviewLive(pageId)) return NextResponse.json({ error: "Page not found." }, { status: 404 }); return NextResponse.json({ ok: true, status: "LIVE" }); }
  try { await setPageLive(pageId, admin.id); return NextResponse.json({ ok: true, status: "LIVE" }); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Page is not ready." }, { status: 400 }); }
}
