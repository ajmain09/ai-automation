import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";
import { isSameOrigin } from "@/lib/auth/csrf";
import { isDevPreview } from "@/lib/env";
import { setPreviewGlobalAi } from "@/services/preview/store";
export async function POST(request: Request) { if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 }); const admin = await requireAdmin(); const parsed = z.object({ paused: z.boolean() }).safeParse(await request.json()); if (!parsed.success) return NextResponse.json({ error: "Invalid setting." }, { status: 400 }); if (isDevPreview()) return NextResponse.json({ ok: true, paused: setPreviewGlobalAi(parsed.data.paused) }); await prisma.systemSetting.upsert({ where: { key: "global_ai_paused" }, update: { value: parsed.data.paused }, create: { key: "global_ai_paused", value: parsed.data.paused } }); await prisma.auditLog.create({ data: { adminId: admin.id, action: parsed.data.paused ? "global_ai.paused" : "global_ai.resumed" } }); return NextResponse.json({ ok: true, paused: parsed.data.paused }); }
