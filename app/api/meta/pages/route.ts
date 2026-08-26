import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { decryptCredential } from "@/lib/encryption/service";
import { MetaApiError, missingRequiredPermissions, pageDiscoveryStatus, REQUIRED_META_PERMISSIONS, runPageAccessDiagnostic } from "@/services/meta/service";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";
import { isDevPreview } from "@/lib/env";
import { PreviewFacebookConnector } from "@/services/meta/connector";
import { logger, redactSensitiveText } from "@/lib/logging/logger";
import { upsertActionableIssue } from "@/services/issues/service";

export async function GET(request: Request) {
  await requireAdmin();
  if (isDevPreview()) return NextResponse.json({ pages: await new PreviewFacebookConnector().discoverPages(), permissions: REQUIRED_META_PERMISSIONS.map((permission) => ({ permission, status: "granted" })), status: "READY", state: "preview" });
  const state = z.string().min(20).safeParse(new URL(request.url).searchParams.get("state"));
  if (!state.success) return NextResponse.json({ error: "Invalid OAuth state." }, { status: 400 });
  const hash = (await import("node:crypto")).createHash("sha256").update(state.data).digest("hex");
  const record = await prisma.oAuthState.findUnique({ where: { stateHash: hash } });
  if (!record?.encryptedUserToken || record.consumedAt || record.expiresAt < new Date()) return NextResponse.json({ status: "OAUTH_EXPIRED", pages: [], permissions: [], message: "OAuth session expired. Reconnect Facebook to continue." }, { status: 400 });
  try {
    const userToken = decryptCredential(record.encryptedUserToken);
     const result = await runPageAccessDiagnostic(userToken, { oauthCallback: true });
     const { diagnostic } = result;
     await prisma.oAuthState.update({ where: { id: record.id }, data: { permissionDiagnostics: diagnostic.permissions } });
     const missing = missingRequiredPermissions(diagnostic.permissions);
     if (missing.length > 0) return NextResponse.json({ pages: [], permissions: diagnostic.permissions, diagnostics: diagnostic, status: "PERMISSION_MISSING", message: "Facebook permissions are required to discover manageable Pages.", state: state.data });
     const status = pageDiscoveryStatus(diagnostic);
     return NextResponse.json({ pages: result.pages.map(({ id, name }) => ({ id, name })), permissions: diagnostic.permissions, diagnostics: diagnostic, status, state: state.data, ...(status === "NO_PAGES" ? { message: "Facebook login succeeded, but Meta returned no Page identities." } : {}) });
  } catch (error) {
    const details = error instanceof MetaApiError ? error.details : { operation: "pages.discovery" };
    const message = error instanceof Error ? redactSensitiveText(error.message).slice(0, 500) : "Meta page discovery failed.";
    logger.error({ operation: details.operation, metaErrorCode: details.code, metaErrorType: details.type, metaErrorSubcode: details.subcode }, "Meta page discovery failed");
    await upsertActionableIssue({ type: "META_PAGE_DISCOVERY", title: "Facebook Page discovery needs attention", description: `Meta ${details.operation} failed${details.code ? ` (code ${details.code})` : ""}${details.subcode ? ` (subcode ${details.subcode})` : ""}: ${message}`, severity: "high", resolutionAction: "Review Meta Login for Business permissions and configuration, then retry Page discovery." });
    return NextResponse.json({ pages: [], permissions: [], status: "META_ERROR", message: "Meta could not complete Facebook Page discovery. Review the Issues Center for diagnostic details." }, { status: 502 });
  }
}
