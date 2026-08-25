import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { businessSetupSchema } from "@/lib/validation/business";
import { DeepSeekProvider } from "@/services/ai/provider";
import { analyzeBusiness, normalizeBusinessParse } from "@/services/business/analyzer";
import { saveBusinessDraft } from "@/services/configuration/service";
import { isSameOrigin } from "@/lib/auth/csrf";
import { getEnv, isDevPreview } from "@/lib/env";
import { persistPreviewState, savePreviewBusiness } from "@/services/preview/store";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 });
  const admin = await requireAdmin();
  const parsed = businessSetupSchema.pick({ pageId: true, rawBusinessInfo: true }).safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Please provide the raw business information." }, { status: 400 });
  if (isDevPreview()) {
    const firstLine = parsed.data.rawBusinessInfo.split("\n").map((line) => line.trim()).find(Boolean) ?? "Preview business";
    const result = { business_profile: { business_name: firstLine.slice(0, 80), description: "A customer-focused business with clear product information and dependable delivery.", benefits: ["Clear product guidance", "Friendly support"] }, products: [{ name: "Preview Featured Product", description: "A representative product parsed from the business notes.", tags: ["featured", "preview"], variants: [{ sku: "PREVIEW-001", size: "Standard", color: null, current_price: 24, old_price: 29 }] }], policies: { delivery: "Delivery within 3–5 business days.", cod: "Cash on delivery is available.", faq: ["How long is delivery? 3–5 business days."] }, sales_instructions: "Never invent prices, policies, or product facts.", order_requirements: ["name", "phone", "address", "product", "variant", "quantity"], unknown_information: ["Final delivery fee"], conflicts: [] };
    const draft = savePreviewBusiness({ ...parsed.data, businessName: result.business_profile.business_name, description: result.business_profile.description, benefits: result.business_profile.benefits.join("\n"), deliveryPolicy: result.policies.delivery, codPolicy: result.policies.cod, faq: result.policies.faq.join("\n"), salesInstructions: result.sales_instructions, notes: result.order_requirements.join("\n") }); persistPreviewState();
    return NextResponse.json({ ok: true, configured: false, result, draftId: draft.id });
  }
  if (!getEnv().DEEPSEEK_API_KEY) return NextResponse.json({ configured: false, error: "DeepSeek not configured" }, { status: 503 });
  try {
    const result = normalizeBusinessParse(await analyzeBusiness({ ...parsed.data, provider: new DeepSeekProvider() }));
    const draft = await saveBusinessDraft({ ...parsed.data, businessData: result }, admin.id);
    return NextResponse.json({ ok: true, draftId: draft.id, result });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to analyze the business." }, { status: 502 }); }
}
