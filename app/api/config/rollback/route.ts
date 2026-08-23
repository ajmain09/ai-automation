import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { rollbackToConfiguration } from "@/services/configuration/service";
import { z } from "zod";
import { isSameOrigin } from "@/lib/auth/csrf";
import { isDevPreview } from "@/lib/env";
import { rollbackPreview } from "@/services/preview/store";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 });
  const admin = await requireAdmin();
  const parsed = z.object({ pageId: z.string().uuid(), version: z.number().int().positive() }).safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid rollback request." }, { status: 400 });
  try { const result = isDevPreview() ? rollbackPreview(parsed.data.pageId, parsed.data.version) : await rollbackToConfiguration(parsed.data.pageId, parsed.data.version, admin.id); return NextResponse.json({ ok: true, id: result.id }); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to roll back configuration." }, { status: 400 }); }
}
