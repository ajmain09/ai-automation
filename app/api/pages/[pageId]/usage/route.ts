import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { getPageUsage } from "@/services/usage/queries";
import { z } from "zod";

export async function GET(_request: Request, { params }: { params: Promise<{ pageId: string }> }) {
  await requireAdmin(); const { pageId } = await params;
  if (!z.string().uuid().safeParse(pageId).success) return NextResponse.json({ error: "Invalid page." }, { status: 400 });
  return NextResponse.json(await getPageUsage(pageId));
}
