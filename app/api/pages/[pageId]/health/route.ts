import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { getSystemHealth } from "@/services/health/service";

export async function GET(_request: Request, { params }: { params: Promise<{ pageId: string }> }) {
  await requireAdmin();
  const parsed = z.string().uuid().safeParse((await params).pageId);
  if (!parsed.success) return NextResponse.json({ error: "Invalid Page." }, { status: 400 });
  return NextResponse.json({ health: await getSystemHealth(parsed.data) });
}
