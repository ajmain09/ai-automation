import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { publishLatestDraft } from "@/services/configuration/service";
import { z } from "zod";
import { isSameOrigin } from "@/lib/auth/csrf";
import { isDevPreview } from "@/lib/env";
import { publishPreview } from "@/services/preview/store";
export async function POST(request: Request) { if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 }); const admin = await requireAdmin(); const parsed = z.object({ pageId: z.string().uuid() }).safeParse(await request.json()); if (!parsed.success) return NextResponse.json({ error: "Invalid page." }, { status: 400 }); try { if (isDevPreview()) publishPreview(parsed.data.pageId); else await publishLatestDraft(parsed.data.pageId, admin.id); return NextResponse.json({ ok: true }); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to publish." }, { status: 400 }); } }
