import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { getPageUsage } from "@/services/usage/queries";
import { resolvePageId } from "@/services/pages/queries";

export async function GET(_request: Request, { params }: { params: Promise<{ pageId: string }> }) {
  await requireAdmin(); const { pageId } = await params;
  const resolvedPageId = await resolvePageId(pageId);
  if (!resolvedPageId) return NextResponse.json({ error: "Page not found." }, { status: 404 });
  return NextResponse.json(await getPageUsage(resolvedPageId));
}
