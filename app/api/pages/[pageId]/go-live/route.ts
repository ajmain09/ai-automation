import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { setPageLive } from "@/services/pages/readiness";
import { z } from "zod";

export async function POST(_request: Request, { params }: { params: Promise<{ pageId: string }> }) {
  const admin = await requireAdmin();
  const pageId = (await params).pageId;
  if (!z.string().uuid().safeParse(pageId).success) return NextResponse.json({ error: "Invalid Page." }, { status: 400 });
  try { await setPageLive(pageId, admin.id); return NextResponse.json({ ok: true, status: "LIVE" }); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Page is not ready." }, { status: 400 }); }
}
