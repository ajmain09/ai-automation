import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { rollbackToConfiguration } from "@/services/configuration/service";
import { z } from "zod";
import { isSameOrigin } from "@/lib/auth/csrf";
import { isDevPreview } from "@/lib/env";
import { rollbackPreview } from "@/services/preview/store";
import { resolvePageId } from "@/services/pages/queries";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 });
  const admin = await requireAdmin();
  const parsed = z.object({ pageId: z.string().trim().min(1), version: z.number().int().positive() }).safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid rollback request." }, { status: 400 });
  const pageId = await resolvePageId(parsed.data.pageId); if (!pageId) return NextResponse.json({ error: "Page not found." }, { status: 404 });
  try { const result = isDevPreview() ? rollbackPreview(pageId, parsed.data.version) : await rollbackToConfiguration(pageId, parsed.data.version, admin.id); return NextResponse.json({ ok: true, id: result.id }); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to roll back configuration." }, { status: 400 }); }
}
