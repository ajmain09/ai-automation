import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { getSystemHealth } from "@/services/health/service";

export async function GET(_request: Request, { params }: { params: Promise<{ pageId: string }> }) {
  await requireAdmin();
  const pageId = (await params).pageId;
  try { return NextResponse.json({ health: await getSystemHealth(pageId) }); } catch { return NextResponse.json({ error: "Page not found." }, { status: 404 }); }
}
