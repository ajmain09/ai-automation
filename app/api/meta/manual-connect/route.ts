import { NextResponse } from "next/server";
import { z } from "zod";
import { isSameOrigin } from "@/lib/auth/csrf";
import { requireAdmin } from "@/lib/auth/session";
import { isDevPreview } from "@/lib/env";
import {
  connectFacebookPage,
  FacebookConnectionError,
  FacebookPageAlreadyConnectedError,
} from "@/services/meta/connection";
import {
  connectPreviewPage,
  createPreviewPage,
  getPreviewFacebookPage,
  getPreviewPage,
  getPreviewPages,
} from "@/services/preview/store";

const manualConnectSchema = z.object({
  metaPageId: z.string().trim().regex(/^\d{5,32}$/),
  pageAccessToken: z.string().trim().min(10).max(4096),
  existingPageId: z.string().uuid().optional(),
});

function duplicateResponse(page: { id: string; slug: string; name: string }) {
  return NextResponse.json({
    status: "PAGE_ALREADY_CONNECTED",
    error: "Facebook Page already connected",
    pageId: page.id,
    slug: page.slug,
    pageName: page.name,
    manageUrl: `/pages/${page.slug}`,
  }, { status: 409 });
}

function statusFor(error: FacebookConnectionError) {
  if (error.code === "PAGE_ALREADY_CONNECTED") return 409;
  if (error.code === "META_UNAVAILABLE" || error.code === "WEBHOOK_ERROR") return 502;
  if (error.code === "PERMISSION_ERROR") return 403;
  return 422;
}

function previewConnect(input: z.infer<typeof manualConnectSchema>) {
  const candidate = getPreviewFacebookPage(input.metaPageId);
  if (!candidate) throw new FacebookConnectionError("TOKEN_INVALID", "That preview Facebook Page is not available.");
  const duplicate = getPreviewPages().find((page) => page.metaPageId === input.metaPageId);
  if (duplicate && duplicate.id !== input.existingPageId) return { duplicate } as const;
  const workspace = input.existingPageId ? getPreviewPage(input.existingPageId) : createPreviewPage(candidate.name);
  if (!workspace) throw new FacebookConnectionError("PAGE_ID_MISMATCH", "Preview Page workspace not found.");
  if (workspace.metaPageId && workspace.metaPageId !== input.metaPageId) {
    throw new FacebookConnectionError("TOKEN_REPLACEMENT_FAILED", "The replacement preview credential does not belong to this Page.", "PAGE_ID_MISMATCH");
  }
  const page = connectPreviewPage(workspace.id, candidate.id, candidate.name);
  if (!page) throw new FacebookConnectionError("META_UNAVAILABLE", "Preview Page connection failed.");
  return {
    result: {
      page: { id: page.id, slug: page.slug, name: page.name, metaPageId: candidate.id },
      checks: {
        pageIdentity: "PASS",
        tokenValidity: "PASS",
        metaAppMatch: "PASS",
        webhookSubscription: "PASS",
        messengerConnection: "PASS",
      },
    },
  } as const;
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 });
  const admin = await requireAdmin();
  const parsed = manualConnectSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid Facebook Page ID and Page Access Token." }, { status: 400 });

  try {
    const connected = isDevPreview()
      ? previewConnect(parsed.data)
      : { result: await connectFacebookPage({ ...parsed.data, adminId: admin.id, connectionMethod: "MANUAL" }) };
    if ("duplicate" in connected && connected.duplicate) return duplicateResponse(connected.duplicate);
    return NextResponse.json({ ok: true, status: "CONNECTED", ...connected.result, mocked: isDevPreview() || undefined });
  } catch (error) {
    if (error instanceof FacebookPageAlreadyConnectedError) return duplicateResponse(error.page);
    if (error instanceof FacebookConnectionError) {
      return NextResponse.json({
        status: error.code,
        error: error.message,
        ...(error.reasonCode ? { reasonCode: error.reasonCode } : {}),
      }, { status: statusFor(error) });
    }
    return NextResponse.json({ status: "META_UNAVAILABLE", error: "Facebook Page connection could not be completed." }, { status: 502 });
  }
}
