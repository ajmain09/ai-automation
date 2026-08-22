import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logging/logger";

export async function createProduct(input: { pageId: string; name: string; description?: string; sku: string; price: number; oldPrice?: number; size?: string; color?: string }, adminId: string) {
  const slug = `${input.name}-${input.sku}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const product = await prisma.product.create({ data: { pageId: input.pageId, name: input.name, slug, description: input.description, variants: { create: { sku: input.sku, currentPrice: input.price, oldPrice: input.oldPrice, size: input.size, color: input.color } } } });
  await prisma.auditLog.create({ data: { adminId, pageId: input.pageId, action: "product.created", metadata: { productId: product.id } } });
  logger.info({ pageId: input.pageId, productId: product.id }, "product.created");
  return product;
}
