import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logging/logger";

export async function saveBusinessDraft(input: { pageId: string; rawBusinessInfo: string; businessName?: string; description?: string; benefits?: string; deliveryPolicy?: string; codPolicy?: string; faq?: string; salesInstructions?: string; notes?: string }, adminId: string) {
  return prisma.$transaction(async (tx) => {
    const latest = await tx.configurationVersion.findFirst({ where: { pageId: input.pageId }, orderBy: { version: "desc" } });
    const version = (latest?.version ?? 0) + 1;
    const config = await tx.configurationVersion.create({ data: { pageId: input.pageId, version, status: "DRAFT", label: `Draft ${version}`, rawBusinessInfo: input.rawBusinessInfo } });
    await tx.businessProfile.upsert({ where: { pageId: input.pageId }, update: { businessName: input.businessName, description: input.description, benefits: input.benefits ? input.benefits.split("\n").filter(Boolean) : [], deliveryPolicy: input.deliveryPolicy, codPolicy: input.codPolicy, faq: input.faq ? [input.faq] : [], salesInstructions: input.salesInstructions, notes: input.notes }, create: { pageId: input.pageId, businessName: input.businessName, description: input.description, benefits: input.benefits ? input.benefits.split("\n").filter(Boolean) : [], deliveryPolicy: input.deliveryPolicy, codPolicy: input.codPolicy, faq: input.faq ? [input.faq] : [], salesInstructions: input.salesInstructions, notes: input.notes } });
    await tx.auditLog.create({ data: { adminId, pageId: input.pageId, action: "business.draft_saved", metadata: { version } } });
    logger.info({ pageId: input.pageId, version }, "business.draft_saved");
    return config;
  });
}

export async function publishLatestDraft(pageId: string, adminId: string) {
  return prisma.$transaction(async (tx) => {
    const draft = await tx.configurationVersion.findFirst({ where: { pageId, status: "DRAFT" }, orderBy: { version: "desc" } });
    if (!draft) throw new Error("No draft configuration to publish");
    await tx.configurationVersion.updateMany({ where: { pageId, status: "LIVE" }, data: { status: "ARCHIVED" } });
    const live = await tx.configurationVersion.update({ where: { id: draft.id }, data: { status: "LIVE", publishedAt: new Date() } });
    await tx.auditLog.create({ data: { adminId, pageId, action: "configuration.published", metadata: { version: draft.version } } });
    return live;
  });
}
