import { NextResponse } from "next/server";
export async function POST() { return NextResponse.json({ error: "Global AI control was removed. Configure AI inside the Page workspace." }, { status: 410 }); }
