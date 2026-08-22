import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";
export async function POST(request: Request, { params }: { params: Promise<{ pageId: string }> }) { const admin = await requireAdmin(); const { pageId } = await params; const parsed = z.object({ enabled: z.boolean() }).safeParse(await request.json()); if (!parsed.success) return NextResponse.json({ error: "Invalid setting." }, { status: 400 }); const page = await prisma.page.update({ where: { id: pageId }, data: { aiEnabled: parsed.data.enabled } }); await prisma.auditLog.create({ data: { adminId: admin.id, pageId, action: parsed.data.enabled ? "ai.enabled" : "ai.paused" } }); return NextResponse.json({ ok: true, enabled: page.aiEnabled }); }
