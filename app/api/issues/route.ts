import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { getOpenIssues, resolveIssue } from "@/services/issues/service";
import { z } from "zod";
import { isSameOrigin } from "@/lib/auth/csrf";

export async function GET() { await requireAdmin(); return NextResponse.json({ issues: await getOpenIssues() }); }
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 });
  await requireAdmin();
  const parsed = z.object({ issueId: z.string().uuid(), action: z.literal("resolve") }).safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid issue action." }, { status: 400 });
  await resolveIssue(parsed.data.issueId);
  return NextResponse.json({ ok: true });
}
