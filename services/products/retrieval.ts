import { prisma } from "@/lib/db/prisma";
import { isDevPreview } from "@/lib/env";
import { getPreviewPage } from "@/services/preview/store";

export type RetrievedProduct = { id: string; name: string; description: string | null; tags: string[]; variants: Array<{ id: string; sku: string; size: string | null; color: string | null; currentPrice: string; oldPrice: string | null; stockStatus: string }> };
const words = (text: string) => [...new Set(text.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 2))];

export function rankProducts<T extends { id: string; name: string; description?: string | null; tags?: unknown }>(products: T[], query: string, limit = 8) {
  const terms = words(query);
  return products.map((product) => { const haystack = `${product.name} ${product.description ?? ""} ${Array.isArray(product.tags) ? product.tags.join(" ") : ""}`.toLocaleLowerCase(); const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0); return { product, score }; }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map((item) => item.product);
}

export async function loadCanonicalPageProducts(pageId: string) {
  if (isDevPreview()) return getPreviewPage(pageId)?.products.filter((product) => product.active).map((product) => ({ ...product, tags: product.tags ?? [] })) ?? [];
  return prisma.product.findMany({ where: { pageId, active: true }, include: { variants: { where: { active: true }, orderBy: { currentPrice: "asc" } } }, orderBy: { createdAt: "asc" } });
}

export async function validatePageProductTruth(pageId: string) {
  try {
    const products = await loadCanonicalPageProducts(pageId);
    return evaluateProductTruth(products);
  } catch { return { ok: false, detail: "Canonical Page product truth could not be loaded." }; }
}

export function evaluateProductTruth(products: Array<{ variants: Array<{ currentPrice: unknown; stockStatus: unknown }> }>) {
  const validStatuses = new Set(["IN_STOCK", "LOW_STOCK", "OUT_OF_STOCK", "PREORDER"]);
  const sellable = products.some((product) => product.variants.some((variant) => Number(variant.currentPrice) > 0 && validStatuses.has(String(variant.stockStatus))));
  return { ok: products.length > 0 && sellable, detail: sellable ? "Canonical Page products and variants are valid." : "Product catalog has no valid active variant." };
}

export async function retrieveRelevantProducts(pageId: string, query: string, limit = 8): Promise<RetrievedProduct[]> {
  if (isDevPreview()) {
    const products = getPreviewPage(pageId)?.products.filter((product) => product.active).map((product) => ({ ...product, tags: product.tags ?? [] })) ?? [];
    return rankProducts(products, query, limit).map((product) => ({ id: product.id, name: product.name, description: product.description, tags: Array.isArray(product.tags) ? product.tags.map(String) : [], variants: product.variants.filter((variant) => variant.active).map((variant) => ({ id: variant.id, sku: variant.sku, size: variant.size, color: variant.color, currentPrice: String(variant.currentPrice), oldPrice: variant.oldPrice === null ? null : String(variant.oldPrice), stockStatus: variant.stockStatus })) }));
  }
  const products = await loadCanonicalPageProducts(pageId);
  return rankProducts(products, query, limit).map((product) => ({ id: product.id, name: product.name, description: product.description, tags: Array.isArray(product.tags) ? product.tags.map(String) : [], variants: product.variants.map((variant) => ({ id: variant.id, sku: variant.sku, size: variant.size, color: variant.color, currentPrice: variant.currentPrice.toString(), oldPrice: variant.oldPrice?.toString() ?? null, stockStatus: variant.stockStatus })) }));
}
