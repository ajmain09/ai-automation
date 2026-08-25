import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { isSameOrigin } from "@/lib/auth/csrf";
import { isDevPreview } from "@/lib/env";
import { setPreviewAi } from "@/services/preview/store";
export async function POST(request: Request, { params }: { params: Promise<{ pageId: string }> }) { if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 }); const admin = await requireAdmin(); const { pageId } = await params; const parsed = z.object({ enabled: z.boolean() }).safeParse(await request.json()); if (!parsed.success) return NextResponse.json({ error: "Invalid setting." }, { status: 400 }); if (isDevPreview()) { const page = setPreviewAi(parsed.data.enabled, pageId); return page ? NextResponse.json({ ok: true, enabled: page.aiEnabled }) : NextResponse.json({ error: "Page not found." }, { status: 404 }); } const existing = await prisma.page.findFirst({ where: { OR: [{ id: pageId }, { slug: pageId }] }, select: { id: true } }); if (!existing) return NextResponse.json({ error: "Page not found." }, { status: 404 }); const page = await prisma.page.update({ where: { id: existing.id }, data: { aiEnabled: parsed.data.enabled } }); await prisma.auditLog.create({ data: { adminId: admin.id, pageId: existing.id, action: parsed.data.enabled ? "ai.enabled" : "ai.paused" } }); return NextResponse.json({ ok: true, enabled: page.aiEnabled }); }
