import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { isSameOrigin } from "@/lib/auth/csrf";
import { z } from "zod";

const schema = z.object({ currency: z.string().trim().min(3).max(3), countryCode: z.string().trim().min(2).max(3), defaultLanguage: z.string().trim().min(2).max(10), tone: z.string().trim().min(2).max(50), requiredOrderFields: z.array(z.enum(["name", "phone", "address", "product", "variant", "quantity"])).min(1).max(20) });
export async function POST(request: Request, { params }: { params: Promise<{ pageId: string }> }) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 });
  const admin = await requireAdmin(); const { pageId } = await params;
  if (!z.string().uuid().safeParse(pageId).success) return NextResponse.json({ error: "Invalid Page." }, { status: 400 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Check the page settings." }, { status: 400 });
  const settings = await prisma.$transaction(async (tx) => { const value = await tx.pageSettings.upsert({ where: { pageId }, update: parsed.data, create: { pageId, ...parsed.data } }); await tx.auditLog.create({ data: { adminId: admin.id, pageId, action: "page.settings_updated" } }); return value; });
  return NextResponse.json({ ok: true, id: settings.id });
}
