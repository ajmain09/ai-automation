import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { FacebookConnectionError, testFacebookConnection } from "@/services/meta/connection";
import { z } from "zod";
import { isSameOrigin } from "@/lib/auth/csrf";
import { isDevPreview } from "@/lib/env";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 });
  const admin = await requireAdmin(); const parsed = z.object({ pageId: z.string().uuid() }).safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid Page." }, { status: 400 });
  if (isDevPreview()) return NextResponse.json({ ok: true, identity: { id: parsed.data.pageId, name: "Preview Page" }, checks: { pageIdentity: "PASS", tokenValidity: "PASS", metaAppMatch: "PASS", webhookSubscription: "PASS", messengerConnection: "PASS" }, mocked: true });
  try {
    const result = await testFacebookConnection(parsed.data.pageId, admin.id);
    return NextResponse.json({ ok: true, identity: { id: result.page.metaPageId, name: result.page.name }, checks: result.checks });
  } catch (error) {
    if (error instanceof FacebookConnectionError) return NextResponse.json({ status: error.code, error: error.message }, { status: 502 });
    return NextResponse.json({ status: "META_UNAVAILABLE", error: "Meta connection health check failed." }, { status: 502 });
  }
}
