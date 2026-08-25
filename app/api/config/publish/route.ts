import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { publishLatestDraft } from "@/services/configuration/service";
import { z } from "zod";
import { isSameOrigin } from "@/lib/auth/csrf";
import { isDevPreview } from "@/lib/env";
import { publishPreview } from "@/services/preview/store";
import { resolvePageId } from "@/services/pages/queries";
export async function POST(request: Request) { if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 }); const admin = await requireAdmin(); const parsed = z.object({ pageId: z.string().trim().min(1) }).safeParse(await request.json()); if (!parsed.success) return NextResponse.json({ error: "Invalid page." }, { status: 400 }); const pageId = await resolvePageId(parsed.data.pageId); if (!pageId) return NextResponse.json({ error: "Page not found." }, { status: 404 }); try { if (isDevPreview()) publishPreview(pageId); else await publishLatestDraft(pageId, admin.id); return NextResponse.json({ ok: true }); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to publish." }, { status: 400 }); } }
