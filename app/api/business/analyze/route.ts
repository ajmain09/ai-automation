import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { businessSetupSchema } from "@/lib/validation/business";
import { DeepSeekProvider } from "@/services/ai/provider";
import { analyzeBusiness, normalizeBusinessParse } from "@/services/business/analyzer";
import { saveBusinessDraft } from "@/services/configuration/service";
import { isSameOrigin } from "@/lib/auth/csrf";
import { getEnv, isDevPreview } from "@/lib/env";
import { savePreviewBusiness } from "@/services/preview/store";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 });
  const admin = await requireAdmin();
  const parsed = businessSetupSchema.pick({ pageId: true, rawBusinessInfo: true }).safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Please provide the raw business information." }, { status: 400 });
  if (!getEnv().DEEPSEEK_API_KEY) return NextResponse.json({ configured: false, error: "DeepSeek not configured" }, { status: 503 });
  try {
    const result = normalizeBusinessParse(await analyzeBusiness({ ...parsed.data, provider: new DeepSeekProvider() }));
    if (isDevPreview()) return NextResponse.json({ ok: true, result, draftId: savePreviewBusiness({ ...parsed.data, businessName: result.business_profile.business_name ?? undefined, description: result.business_profile.description ?? undefined, benefits: result.business_profile.benefits.join("\n"), deliveryPolicy: result.policies.delivery ?? undefined, codPolicy: result.policies.cod ?? undefined, faq: result.policies.faq.join("\n"), salesInstructions: result.sales_instructions ?? undefined, notes: result.order_requirements.join("\n") }).id });
    const draft = await saveBusinessDraft({ ...parsed.data, businessData: result }, admin.id);
    return NextResponse.json({ ok: true, draftId: draft.id, result });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to analyze the business." }, { status: 502 }); }
}
