import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { decryptCredential } from "@/lib/encryption/service";
import { connectMetaPage, discoverPages, healthCheckMetaPage } from "@/services/meta/service";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";
import { isSameOrigin } from "@/lib/auth/csrf";
import { isDevPreview } from "@/lib/env";
import { connectPreviewPage } from "@/services/preview/store";

const schema = z.object({ pageId: z.string().uuid(), state: z.string().min(20).optional(), metaPageId: z.string().min(1).max(100) });
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 });
  const admin = await requireAdmin();
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid page connection request." }, { status: 400 });
  if (isDevPreview()) { const page = connectPreviewPage(parsed.data.pageId, parsed.data.metaPageId, parsed.data.metaPageId === "preview-meta-page-001" ? "Karseell Bangladesh" : parsed.data.metaPageId === "preview-meta-page-003" ? "Demo Fashion" : "Growthifyx Demo Store"); return page ? NextResponse.json({ ok: true, pageId: page.id }) : NextResponse.json({ error: "Page not found." }, { status: 404 }); }
  if (!parsed.data.state) return NextResponse.json({ error: "OAuth session is required." }, { status: 400 });
  const hash = (await import("node:crypto")).createHash("sha256").update(parsed.data.state).digest("hex");
  const state = await prisma.oAuthState.findUnique({ where: { stateHash: hash } });
  if (!state?.encryptedUserToken || state.expiresAt < new Date()) return NextResponse.json({ error: "OAuth session expired." }, { status: 400 });
  const candidate = (await discoverPages(decryptCredential(state.encryptedUserToken))).find((page) => page.id === parsed.data.metaPageId);
  if (!candidate) return NextResponse.json({ error: "That Page is not available to this admin." }, { status: 403 });
  const consumed = await prisma.oAuthState.updateMany({ where: { id: state.id, consumedAt: null }, data: { consumedAt: new Date(), encryptedUserToken: null } });
  if (consumed.count !== 1) return NextResponse.json({ error: "OAuth session has already been used." }, { status: 409 });
  await connectMetaPage({ pageId: parsed.data.pageId, metaPageId: candidate.id, name: candidate.name, pageAccessToken: candidate.access_token });
  try { await healthCheckMetaPage(parsed.data.pageId); } catch { return NextResponse.json({ error: "Page credentials were saved but Meta health verification failed." }, { status: 502 }); }
  await prisma.auditLog.create({ data: { adminId: admin.id, pageId: parsed.data.pageId, action: "meta.page_connected", metadata: { metaPageId: candidate.id } } });
  return NextResponse.json({ ok: true });
}
