import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { checkPageReadiness } from "@/services/pages/readiness";

export async function GET(_request: Request, { params }: { params: Promise<{ pageId: string }> }) {
  await requireAdmin();
  const pageId = (await params).pageId;
  if (!z.string().uuid().safeParse(pageId).success) return NextResponse.json({ error: "Invalid Page." }, { status: 400 });
  return NextResponse.json(await checkPageReadiness(pageId));
}
