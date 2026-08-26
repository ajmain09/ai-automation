import { NextResponse } from "next/server";
import { z } from "zod";
import { isSameOrigin } from "@/lib/auth/csrf";
import { requireAdmin } from "@/lib/auth/session";
import { isDevPreview } from "@/lib/env";
import {
  disconnectFacebookPage,
  FacebookConnectionError,
  repairFacebookSubscription,
  testFacebookConnection,
} from "@/services/meta/connection";
import { getPreviewPage } from "@/services/preview/store";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("test"), pageId: z.string().uuid() }),
  z.object({ action: z.literal("repair"), pageId: z.string().uuid() }),
  z.object({ action: z.literal("disconnect"), pageId: z.string().uuid(), confirmed: z.literal(true), unsubscribe: z.boolean().default(true) }),
]);

const previewChecks = {
  pageIdentity: "PASS",
  tokenValidity: "PASS",
  metaAppMatch: "PASS",
  webhookSubscription: "PASS",
  messengerConnection: "PASS",
} as const;

function previewResult(pageId: string) {
  const page = getPreviewPage(pageId);
  if (!page?.metaPageId || page.connectionStatus !== "CONNECTED") throw new FacebookConnectionError("TOKEN_INVALID", "Preview Facebook connection is not configured.");
  return { page: { id: page.id, slug: page.slug, name: page.name, metaPageId: page.metaPageId }, checks: previewChecks };
}

function responseStatus(error: FacebookConnectionError) {
  if (error.code === "PERMISSION_ERROR") return 403;
  if (["META_UNAVAILABLE", "WEBHOOK_ERROR"].includes(error.code)) return 502;
  return 422;
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 });
  const admin = await requireAdmin();
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid Facebook connection action." }, { status: 400 });
  try {
    if (isDevPreview()) {
      if (parsed.data.action === "disconnect") return NextResponse.json({ ok: true, disconnected: true, unsubscribeSucceeded: true, mocked: true });
      return NextResponse.json({ ok: true, ...(previewResult(parsed.data.pageId)), mocked: true });
    }
    if (parsed.data.action === "test") return NextResponse.json({ ok: true, ...(await testFacebookConnection(parsed.data.pageId, admin.id)) });
    if (parsed.data.action === "repair") return NextResponse.json({ ok: true, ...(await repairFacebookSubscription(parsed.data.pageId, admin.id)) });
    return NextResponse.json({ ok: true, ...(await disconnectFacebookPage(parsed.data.pageId, admin.id, parsed.data.unsubscribe)) });
  } catch (error) {
    if (error instanceof FacebookConnectionError) {
      return NextResponse.json({ status: error.code, error: error.message, ...(error.reasonCode ? { reasonCode: error.reasonCode } : {}) }, { status: responseStatus(error) });
    }
    return NextResponse.json({ status: "META_UNAVAILABLE", error: "Facebook connection action could not be completed." }, { status: 502 });
  }
}
