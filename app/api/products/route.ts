import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { productSchema } from "@/lib/validation/business";
import { createProduct } from "@/services/products/service";

export async function POST(request: Request) {
  const admin = await requireAdmin(); const parsed = productSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Check the product details and try again." }, { status: 400 });
  const product = await createProduct(parsed.data, admin.id); return NextResponse.json({ ok: true, id: product.id });
}
