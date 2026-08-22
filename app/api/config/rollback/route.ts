import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { rollbackToConfiguration } from "@/services/configuration/service";
import { z } from "zod";

export async function POST(request: Request) {
  const admin = await requireAdmin();
  const parsed = z.object({ pageId: z.string().uuid(), version: z.number().int().positive() }).safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid rollback request." }, { status: 400 });
  try { const result = await rollbackToConfiguration(parsed.data.pageId, parsed.data.version, admin.id); return NextResponse.json({ ok: true, id: result.id }); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to roll back configuration." }, { status: 400 }); }
}
