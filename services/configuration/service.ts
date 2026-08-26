import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logging/logger";
import { BusinessParse } from "@/lib/validation/ai";
import { Prisma } from "@prisma/client";

type MaterializedConfig = { business_profile?: { business_name?: string | null; description?: string | null; benefits?: string[] }; policies?: { delivery?: string | null; cod?: string | null; faq?: string[] }; sales_instructions?: string | null; order_requirements?: string[]; products?: Array<{ name: string; description?: string | null; tags?: string[]; variants?: Array<{ sku: string; size?: string | null; color?: string | null; current_price: number; old_price?: number | null }> }> };

async function materializeConfiguration(tx: Prisma.TransactionClient, pageId: string, data: MaterializedConfig) {
  await tx.productVariant.updateMany({ where: { product: { pageId } }, data: { active: false } });
  await tx.product.updateMany({ where: { pageId }, data: { active: false } });
  await tx.businessProfile.upsert({ where: { pageId }, update: { businessName: data.business_profile?.business_name ?? null, description: data.business_profile?.description ?? null, benefits: data.business_profile?.benefits ?? [], deliveryPolicy: data.policies?.delivery ?? null, codPolicy: data.policies?.cod ?? null, faq: data.policies?.faq ?? [], salesInstructions: data.sales_instructions ?? null, orderRequirements: data.order_requirements ?? [] }, create: { pageId, businessName: data.business_profile?.business_name ?? null, description: data.business_profile?.description ?? null, benefits: data.business_profile?.benefits ?? [], deliveryPolicy: data.policies?.delivery ?? null, codPolicy: data.policies?.cod ?? null, faq: data.policies?.faq ?? [], salesInstructions: data.sales_instructions ?? null, orderRequirements: data.order_requirements ?? [] } });
  for (const product of data.products ?? []) {
    const slug = product.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || `product-${Date.now()}`;
    const saved = await tx.product.upsert({ where: { pageId_slug: { pageId, slug } }, update: { name: product.name, description: product.description ?? null, tags: product.tags ?? [], active: true }, create: { pageId, name: product.name, slug, description: product.description ?? null, tags: product.tags ?? [] } });
    for (const variant of product.variants ?? []) await tx.productVariant.upsert({ where: { productId_sku: { productId: saved.id, sku: variant.sku } }, update: { size: variant.size ?? null, color: variant.color ?? null, currentPrice: variant.current_price, oldPrice: variant.old_price ?? null, active: true }, create: { productId: saved.id, sku: variant.sku, size: variant.size ?? null, color: variant.color ?? null, currentPrice: variant.current_price, oldPrice: variant.old_price ?? null } });
  }
}

function mergeDraftData(existing: unknown, input: { businessName?: string; description?: string; benefits?: string; deliveryPolicy?: string; codPolicy?: string; faq?: string; salesInstructions?: string; notes?: string }, parsed?: BusinessParse | null) {
  const previous = (existing && typeof existing === "object" ? existing : {}) as Partial<BusinessParse>;
  const base = (parsed ?? previous) as Partial<BusinessParse>;
  return {
    ...base,
    business_profile: { ...(base.business_profile ?? {}), business_name: input.businessName?.trim() || base.business_profile?.business_name || null, description: input.description?.trim() || base.business_profile?.description || null, benefits: input.benefits ? input.benefits.split("\n").filter(Boolean) : base.business_profile?.benefits ?? [] },
    products: Array.isArray(base.products) ? base.products : Array.isArray(previous.products) ? previous.products : [],
    policies: { ...(base.policies ?? {}), delivery: input.deliveryPolicy?.trim() || base.policies?.delivery || null, cod: input.codPolicy?.trim() || base.policies?.cod || null, faq: input.faq ? [input.faq] : base.policies?.faq ?? [] },
    sales_instructions: input.salesInstructions?.trim() || base.sales_instructions || null,
    order_requirements: input.notes ? [input.notes] : base.order_requirements ?? [],
    unknown_information: base.unknown_information ?? [],
    conflicts: base.conflicts ?? [],
  } as BusinessParse;
}

export async function saveBusinessDraft(input: { pageId: string; rawBusinessInfo: string; businessName?: string; description?: string; benefits?: string; deliveryPolicy?: string; codPolicy?: string; faq?: string; salesInstructions?: string; notes?: string; businessData?: BusinessParse | null }, adminId: string) {
  return prisma.$transaction(async (tx) => {
    const latest = await tx.configurationVersion.findFirst({ where: { pageId: input.pageId }, orderBy: { version: "desc" } });
    const latestDraft = latest?.status === "DRAFT" ? latest : await tx.configurationVersion.findFirst({ where: { pageId: input.pageId, status: "DRAFT" }, orderBy: { version: "desc" } });
    const businessData = mergeDraftData(latestDraft?.businessData, input, input.businessData);
    const version = latestDraft?.version ?? (latest?.version ?? 0) + 1;
    const config = latestDraft ? await tx.configurationVersion.update({ where: { id: latestDraft.id }, data: { rawBusinessInfo: input.rawBusinessInfo || latestDraft.rawBusinessInfo, businessData: businessData as object, conflicts: businessData.conflicts as object, parseStatus: businessData.conflicts.some((conflict) => conflict.critical) ? "BLOCKED" : "READY" } }) : await tx.configurationVersion.create({ data: { pageId: input.pageId, version, status: "DRAFT", label: `Draft ${version}`, rawBusinessInfo: input.rawBusinessInfo, businessData: businessData as object, conflicts: businessData.conflicts as object, parseStatus: businessData.conflicts.some((conflict) => conflict.critical) ? "BLOCKED" : "READY" } });
    await tx.auditLog.create({ data: { adminId, pageId: input.pageId, action: "business.draft_saved", metadata: { version } } });
    logger.info({ pageId: input.pageId, version, merged: Boolean(latestDraft) }, "business.draft_saved");
    return config;
  });
}

export async function publishLatestDraft(pageId: string, adminId: string) {
  return prisma.$transaction(async (tx) => {
    const draft = await tx.configurationVersion.findFirst({ where: { pageId, status: "DRAFT" }, orderBy: { version: "desc" } });
    if (!draft) throw new Error("No draft configuration to publish");
    const data = draft.businessData as { business_profile?: { business_name?: string | null; description?: string | null; benefits?: string[] }; policies?: { delivery?: string | null; cod?: string | null; faq?: string[] }; sales_instructions?: string | null; order_requirements?: string[]; products?: Array<{ name: string; description?: string | null; tags?: string[]; variants?: Array<{ sku: string; size?: string | null; color?: string | null; current_price: number; old_price?: number | null }> }>; conflicts?: Array<{ critical?: boolean }> } | null;
    if (data?.conflicts?.some((conflict) => conflict.critical)) throw new Error("Critical business conflicts must be resolved before publishing");
    await tx.configurationVersion.updateMany({ where: { pageId, status: "LIVE" }, data: { status: "ARCHIVED" } });
    const live = await tx.configurationVersion.update({ where: { id: draft.id }, data: { status: "LIVE", publishedAt: new Date() } });
    if (data) await materializeConfiguration(tx, pageId, data);
    await tx.auditLog.create({ data: { adminId, pageId, action: "configuration.published", metadata: { version: draft.version } } });
    return live;
  });
}

export async function rollbackToConfiguration(pageId: string, version: number, adminId: string) {
  return prisma.$transaction(async (tx) => {
    const target = await tx.configurationVersion.findFirst({ where: { pageId, version, status: { in: ["LIVE", "ARCHIVED"] } } });
    if (!target) throw new Error("Configuration version not found in page scope");
    const data = target.businessData as { conflicts?: Array<{ critical?: boolean }> } | null;
    if (data?.conflicts?.some((conflict) => conflict.critical)) throw new Error("Cannot roll back to a configuration with critical conflicts");
    await tx.configurationVersion.updateMany({ where: { pageId, status: "LIVE" }, data: { status: "ARCHIVED" } });
    const live = await tx.configurationVersion.update({ where: { id: target.id }, data: { status: "LIVE", publishedAt: new Date() } });
    if (data) await materializeConfiguration(tx, pageId, target.businessData as MaterializedConfig);
    await tx.auditLog.create({ data: { adminId, pageId, action: "configuration.rollback", metadata: { version } } });
    return live;
  });
}
