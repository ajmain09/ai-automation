import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { productSchema } from "@/lib/validation/business";
import { createProduct } from "@/services/products/service";
import { isSameOrigin } from "@/lib/auth/csrf";
import { isDevPreview } from "@/lib/env";
import { createPreviewProduct } from "@/services/preview/store";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 });
  const admin = await requireAdmin(); const parsed = productSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Check the product details and try again." }, { status: 400 });
  if (isDevPreview()) return NextResponse.json({ ok: true, id: createPreviewProduct(parsed.data).id });
  const product = await createProduct(parsed.data, admin.id); return NextResponse.json({ ok: true, id: product.id });
}
