import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { setPageLive } from "@/services/pages/readiness";
import { isSameOrigin } from "@/lib/auth/csrf";

export async function POST(_request: Request, { params }: { params: Promise<{ pageId: string }> }) {
  if (!isSameOrigin(_request)) return NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 });
  const admin = await requireAdmin();
  const pageId = (await params).pageId;
  try { const page = await setPageLive(pageId, admin.id); if (!page) return NextResponse.json({ error: "Page not found." }, { status: 404 }); return NextResponse.json({ ok: true, status: "LIVE" }); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Page is not ready." }, { status: 400 }); }
}
