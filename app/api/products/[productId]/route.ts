import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { isSameOrigin } from "@/lib/auth/csrf";
import { isDevPreview } from "@/lib/env";
import { deletePreviewProduct, setPreviewProductActive, updatePreviewProduct } from "@/services/preview/store";

const productSchema = z.object({ pageId: z.string().uuid(), name: z.string().trim().min(1).max(160), description: z.string().max(2000).optional(), sku: z.string().trim().min(1).max(80), price: z.coerce.number().positive(), oldPrice: z.coerce.number().positive().optional(), size: z.string().max(80).optional(), color: z.string().max(80).optional(), active: z.boolean().optional() });
const actionSchema = z.object({ pageId: z.string().uuid(), action: z.enum(["activate", "deactivate", "delete"]), name: z.string().optional(), description: z.string().optional(), sku: z.string().optional(), price: z.coerce.number().optional(), oldPrice: z.coerce.number().optional(), size: z.string().optional(), color: z.string().optional() });

export async function PATCH(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 });
  await requireAdmin();
  if (!isDevPreview()) return NextResponse.json({ error: "Product editing requires the configured database runtime." }, { status: 501 });
  const productId = (await params).productId;
  const parsed = productSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Check the product details and try again." }, { status: 400 });
  try { return NextResponse.json({ ok: true, product: updatePreviewProduct({ ...parsed.data, productId }) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update product." }, { status: 400 }); }
}

export async function POST(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 });
  await requireAdmin();
  if (!isDevPreview()) return NextResponse.json({ error: "Product actions require the configured database runtime." }, { status: 501 });
  const productId = (await params).productId;
  const parsed = actionSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid product action." }, { status: 400 });
  try {
    if (parsed.data.action === "delete") deletePreviewProduct(parsed.data.pageId, productId);
    else setPreviewProductActive(parsed.data.pageId, productId, parsed.data.action === "activate");
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update product." }, { status: 400 }); }
}
