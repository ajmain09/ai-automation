import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { decryptCredential } from "@/lib/encryption/service";
import { connectMetaPage, healthCheckMetaPage, MetaApiError, missingBlockingPagePermissions, resolvePageAccessToken, runPageAccessDiagnostic } from "@/services/meta/service";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";
import { isSameOrigin } from "@/lib/auth/csrf";
import { isDevPreview } from "@/lib/env";
import { connectPreviewPage, getPreviewFacebookPage } from "@/services/preview/store";
import { logger, redactSensitiveText } from "@/lib/logging/logger";
import { upsertActionableIssue } from "@/services/issues/service";

const schema = z.object({ pageId: z.string().uuid().optional(), state: z.string().min(20).optional(), metaPageId: z.string().min(1).max(100), name: z.string().trim().min(1).max(160).optional(), refresh: z.boolean().optional() });
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 });
  const admin = await requireAdmin();
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid page connection request." }, { status: 400 });
  if (isDevPreview()) { try { if (!parsed.data.pageId) return NextResponse.json({ error: "A preview Page workspace is required." }, { status: 400 }); const candidate = getPreviewFacebookPage(parsed.data.metaPageId); if (!candidate) return NextResponse.json({ error: "That Facebook Page is not available in preview." }, { status: 404 }); const page = connectPreviewPage(parsed.data.pageId, candidate.id, candidate.name); return page ? NextResponse.json({ ok: true, pageId: page.id, slug: page.slug }) : NextResponse.json({ error: "Page not found." }, { status: 404 }); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to connect the Page." }, { status: 409 }); } }
  if (!parsed.data.state) return NextResponse.json({ error: "OAuth session is required." }, { status: 400 });
  const hash = (await import("node:crypto")).createHash("sha256").update(parsed.data.state).digest("hex");
  const state = await prisma.oAuthState.findUnique({ where: { stateHash: hash } });
  if (!state?.encryptedUserToken || state.consumedAt || state.expiresAt < new Date()) return NextResponse.json({ status: "OAUTH_EXPIRED", error: "OAuth session expired. Reconnect Facebook to continue." }, { status: 400 });
  try {
    const userToken = decryptCredential(state.encryptedUserToken);
    const discovery = await runPageAccessDiagnostic(userToken, { oauthCallback: true });
    const permissions = discovery.diagnostic.permissions;
    const missing = missingBlockingPagePermissions(permissions);
    if (missing.length > 0) return NextResponse.json({ status: "PERMISSION_MISSING", permissions, error: "Required Facebook permissions are missing." }, { status: 403 });
    const candidate = discovery.pages.find((page) => page.id === parsed.data.metaPageId);
    if (!candidate) return NextResponse.json({ status: "NO_PAGES", error: "That Page is not available to this Facebook account." }, { status: 403 });
    let pageAccessToken: string;
    try {
      pageAccessToken = await resolvePageAccessToken(userToken, candidate);
    } catch (error) {
      const details = error instanceof MetaApiError ? error.details : { operation: "page.access_token" };
      logger.warn({ operation: details.operation, metaPageId: candidate.id, metaErrorCode: details.code, metaErrorType: details.type, metaErrorSubcode: details.subcode }, "Meta Page credential resolution failed");
      return NextResponse.json({ status: "PAGE_CREDENTIAL_ERROR", error: "Page discovered successfully, but a Page access credential could not be obtained." }, { status: 502 });
    }
    const existing = await prisma.page.findUnique({ where: { metaPageId: candidate.id }, select: { id: true, slug: true, name: true } });
    if (existing && !parsed.data.refresh) return NextResponse.json({ status: "DUPLICATE", message: "Page already connected", pageId: existing.id, slug: existing.slug, pageName: existing.name, manageUrl: `/pages/${existing.slug}` }, { status: 409 });
    let pageId = existing?.id ?? parsed.data.pageId;
    if (!pageId) {
      const slug = `${candidate.name}-${Date.now()}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const page = await prisma.page.create({ data: { name: candidate.name, slug, settings: { create: { requiredOrderFields: ["name", "phone", "address", "product", "variant", "quantity"] } }, configurationVersions: { create: { version: 1, status: "DRAFT", label: "Initial draft" } }, connection: { create: { status: "PENDING" } } } });
      pageId = page.id;
    }
    await connectMetaPage({ pageId, metaPageId: candidate.id, name: candidate.name, pageAccessToken });
    try { await healthCheckMetaPage(pageId); } catch { return NextResponse.json({ status: "META_ERROR", error: "Meta health verification or webhook subscription failed. The Page was not marked connected." }, { status: 502 }); }
    const { finalizeOAuthState } = await import("@/services/meta/service");
    await finalizeOAuthState(parsed.data.state);
    await prisma.auditLog.create({ data: { adminId: admin.id, pageId, action: existing ? "meta.page_reconnected" : "meta.page_connected", metadata: { metaPageId: candidate.id } } });
    const connected = await prisma.page.findUnique({ where: { id: pageId }, select: { id: true, slug: true } });
    return NextResponse.json({ ok: true, pageId, slug: connected?.slug });
  } catch (error) {
    const details = error instanceof MetaApiError ? error.details : { operation: "page.connection" };
    const message = error instanceof Error ? redactSensitiveText(error.message).slice(0, 500) : "Meta Page connection failed.";
    logger.error({ operation: details.operation, metaErrorCode: details.code, metaErrorType: details.type, metaErrorSubcode: details.subcode }, "Meta Page connection failed");
    await upsertActionableIssue({ type: "META_PAGE_CONNECTION", title: "Facebook Page connection needs attention", description: `Meta ${details.operation} failed${details.code ? ` (code ${details.code})` : ""}: ${message}`, severity: "high", resolutionAction: "Review the Meta configuration and retry the connection." });
    return NextResponse.json({ status: "META_ERROR", error: "Facebook Page connection could not be completed. Review the Issues Center." }, { status: 502 });
  }
}
