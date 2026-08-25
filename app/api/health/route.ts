import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { isDevPreview } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  if (isDevPreview()) return NextResponse.json({ ok: true, database: "not_required", mode: "preview" });
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, database: "healthy" });
  } catch {
    return NextResponse.json({ ok: false, database: "unavailable" }, { status: 503 });
  }
}
