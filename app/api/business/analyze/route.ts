import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { businessSetupSchema } from "@/lib/validation/business";
import { DeepSeekProvider } from "@/services/ai/provider";
import { analyzeBusiness, normalizeBusinessParse } from "@/services/business/analyzer";
import { saveBusinessDraft } from "@/services/configuration/service";

export async function POST(request: Request) {
  const admin = await requireAdmin();
  const parsed = businessSetupSchema.pick({ pageId: true, rawBusinessInfo: true }).safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Please provide the raw business information." }, { status: 400 });
  try {
    const result = normalizeBusinessParse(await analyzeBusiness({ ...parsed.data, provider: new DeepSeekProvider() }));
    const draft = await saveBusinessDraft({ ...parsed.data, businessData: result }, admin.id);
    return NextResponse.json({ ok: true, draftId: draft.id, result });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to analyze the business." }, { status: 502 }); }
}
