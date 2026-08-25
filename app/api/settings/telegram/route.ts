import { NextResponse } from "next/server";
export async function POST() { return NextResponse.json({ error: "Global Telegram was removed. Configure Telegram inside the Page workspace." }, { status: 410 }); }
