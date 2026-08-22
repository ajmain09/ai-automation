import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { publishLatestDraft } from "@/services/configuration/service";
import { z } from "zod";
export async function POST(request: Request) { const admin = await requireAdmin(); const parsed = z.object({ pageId: z.string().uuid() }).safeParse(await request.json()); if (!parsed.success) return NextResponse.json({ error: "Invalid page." }, { status: 400 }); try { await publishLatestDraft(parsed.data.pageId, admin.id); return NextResponse.json({ ok: true }); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to publish." }, { status: 400 }); } }
