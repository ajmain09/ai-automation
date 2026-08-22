import { prisma } from "@/lib/db/prisma";

export async function validateReferencedProducts(pageId: string, productIds: string[]) {
  const unique = [...new Set(productIds)];
  if (!unique.length) return [];
  const products = await prisma.product.findMany({ where: { id: { in: unique }, pageId, active: true }, include: { variants: { where: { active: true } } } });
  if (products.length !== unique.length || products.some((product) => product.variants.length === 0)) throw new Error("AI referenced an unavailable product");
  return products;
}
