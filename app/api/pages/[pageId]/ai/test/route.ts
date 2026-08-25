import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { isSameOrigin } from "@/lib/auth/csrf";
import { isDevPreview } from "@/lib/env";
import { runPreviewAiTest } from "@/services/preview/store";

export async function POST(request: Request, { params }: { params: Promise<{ pageId: string }> }) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 });
  await requireAdmin();
  if (!isDevPreview()) return NextResponse.json({ error: "AI test requires the configured provider runtime." }, { status: 501 });
  const parsed = z.object({ message: z.string().trim().min(1).max(2000) }).safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Enter a customer message first." }, { status: 400 });
  try { return NextResponse.json({ ok: true, result: runPreviewAiTest((await params).pageId, parsed.data.message) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to run the AI test." }, { status: 400 }); }
}
