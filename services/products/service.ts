import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logging/logger";

export async function createProduct(input: { pageId: string; name: string; description?: string; sku: string; price: number; oldPrice?: number; size?: string; color?: string }, adminId: string) {
  const draft = await prisma.$transaction(async (tx) => {
    const page = await tx.page.findUnique({ where: { id: input.pageId }, include: { products: { include: { variants: true } }, configurationVersions: { where: { status: { in: ["LIVE", "DRAFT"] } }, orderBy: { version: "desc" }, take: 1 } } });
    if (!page) throw new Error("Page not found");
    const source = page.configurationVersions[0]?.businessData as { business_profile?: unknown; policies?: unknown; sales_instructions?: unknown; order_requirements?: unknown; products?: Array<Record<string, unknown>> } | null;
    const draftProducts = Array.isArray(source?.products) ? source.products as Array<{ name?: unknown; description?: unknown; tags?: unknown; variants?: Array<{ sku?: unknown; size?: unknown; color?: unknown; current_price?: unknown; old_price?: unknown }> }> : [];
    const products = draftProducts.length ? draftProducts.map((product) => ({ name: String(product.name ?? ""), description: typeof product.description === "string" ? product.description : null, tags: Array.isArray(product.tags) ? product.tags.map(String) : [], variants: (product.variants ?? []).map((variant) => ({ sku: String(variant.sku ?? ""), size: typeof variant.size === "string" ? variant.size : null, color: typeof variant.color === "string" ? variant.color : null, current_price: Number(variant.current_price ?? 0), old_price: variant.old_price === null || variant.old_price === undefined ? null : Number(variant.old_price) })) })) : page.products.map((product) => ({ name: product.name, description: product.description, tags: Array.isArray(product.tags) ? product.tags.map(String) : [], variants: product.variants.map((variant) => ({ sku: variant.sku, size: variant.size, color: variant.color, current_price: Number(variant.currentPrice), old_price: variant.oldPrice === null ? null : Number(variant.oldPrice) })) }));
    products.push({ name: input.name, description: input.description ?? null, tags: [], variants: [{ sku: input.sku, size: input.size ?? null, color: input.color ?? null, current_price: input.price, old_price: input.oldPrice ?? null }] });
    const businessData = { business_profile: source?.business_profile ?? {}, policies: source?.policies ?? {}, sales_instructions: source?.sales_instructions ?? null, order_requirements: source?.order_requirements ?? [], products };
    const latest = await tx.configurationVersion.findFirst({ where: { pageId: input.pageId }, orderBy: { version: "desc" } });
    const created = await tx.configurationVersion.create({ data: { pageId: input.pageId, version: (latest?.version ?? 0) + 1, status: "DRAFT", label: "Catalog draft", businessData: businessData as object, parseStatus: "READY", rawBusinessInfo: latest?.rawBusinessInfo ?? null } });
    await tx.auditLog.create({ data: { adminId, pageId: input.pageId, action: "product.draft_saved", metadata: { version: created.version, sku: input.sku } } });
    return created;
  });
  logger.info({ pageId: input.pageId, version: draft.version }, "product.draft_saved");
  return draft;
}
