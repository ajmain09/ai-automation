import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";
const schema = z.object({ currency: z.string().trim().min(3).max(3), countryCode: z.string().trim().min(2).max(3), defaultLanguage: z.string().trim().min(2).max(10), tone: z.string().trim().min(2).max(50), requiredOrderFields: z.array(z.string()).min(1).max(20) });
export async function POST(request: Request, { params }: { params: Promise<{ pageId: string }> }) { const admin = await requireAdmin(); const { pageId } = await params; const parsed = schema.safeParse(await request.json()); if (!parsed.success) return NextResponse.json({ error: "Check the page settings." }, { status: 400 }); const settings = await prisma.pageSettings.upsert({ where: { pageId }, update: parsed.data, create: { pageId, ...parsed.data } }); await prisma.auditLog.create({ data: { adminId: admin.id, pageId, action: "page.settings_updated" } }); return NextResponse.json({ ok: true, id: settings.id }); }
