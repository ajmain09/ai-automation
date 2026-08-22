import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { businessSetupSchema } from "@/lib/validation/business";
import { saveBusinessDraft } from "@/services/configuration/service";
import { isSameOrigin } from "@/lib/auth/csrf";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 });
  const admin = await requireAdmin(); const parsed = businessSetupSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Please complete the required fields." }, { status: 400 });
  const config = await saveBusinessDraft(parsed.data, admin.id); return NextResponse.json({ ok: true, id: config.id });
}
