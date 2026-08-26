import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { getOperationalHealth } from "@/services/health/service";

export const dynamic = "force-dynamic";
export async function GET() { await requireAdmin(); return NextResponse.json(await getOperationalHealth()); }
