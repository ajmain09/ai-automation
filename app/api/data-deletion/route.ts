import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { isSameOrigin } from "@/lib/auth/csrf";
import { isDevPreview } from "@/lib/env";
import { executeCustomerDataDeletion, deletionRequestSchema } from "@/services/data-deletion/service";
import { deletePreviewCustomerData } from "@/services/preview/store";

const bodySchema = deletionRequestSchema.extend({ confirm: z.literal(true) });

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 });
  const admin = await requireAdmin();
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A valid Page, customer, request key, and confirmation are required." }, { status: 400 });
  try {
    const input = { pageId: parsed.data.pageId, customerId: parsed.data.customerId, requestKey: parsed.data.requestKey };
    const result = isDevPreview() ? deletePreviewCustomerData(input) : await executeCustomerDataDeletion(input, admin.id);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Data deletion could not be completed." }, { status: 400 });
  }
}
