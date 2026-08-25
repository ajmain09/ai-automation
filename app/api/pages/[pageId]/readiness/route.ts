import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { checkPageReadiness } from "@/services/pages/readiness";

export async function GET(_request: Request, { params }: { params: Promise<{ pageId: string }> }) {
  await requireAdmin();
  const pageId = (await params).pageId;
  try { return NextResponse.json(await checkPageReadiness(pageId)); } catch { return NextResponse.json({ error: "Page not found." }, { status: 404 }); }
}
