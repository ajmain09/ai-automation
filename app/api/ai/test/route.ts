import { NextResponse } from "next/server";
export async function POST() { return NextResponse.json({ error: "AI tests are Page-scoped. Use /api/pages/:pageId/ai/test." }, { status: 410 }); }
