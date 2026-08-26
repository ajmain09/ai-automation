import { prisma } from "@/lib/db/prisma";
import { isDevPreview } from "@/lib/env";
import { getPreviewConversations, getPreviewDashboard, getPreviewPage, getPreviewPages, PreviewPage } from "@/services/preview/store";
import { startOfDhakaMonth } from "@/services/time/timezone";

export async function getDashboardData() {
  if (isDevPreview()) return getPreviewDashboard();
  const month = startOfDhakaMonth();
  const [pages, usage] = await Promise.all([
    prisma.page.findMany({ orderBy: { createdAt: "asc" }, include: { telegramSettings: true } }),
    prisma.apiUsage.groupBy({ by: ["pageId"], where: { createdAt: { gte: month } }, _count: { _all: true }, _sum: { totalTokens: true, estimatedCost: true, estimatedCostBdt: true } }),
  ]);
  const usageByPage = new Map(usage.map((row) => [row.pageId, { calls: row._count._all, totalTokens: row._sum.totalTokens ?? 0, estimatedCost: Number(row._sum.estimatedCost ?? 0), estimatedCostBdt: Number(row._sum.estimatedCostBdt ?? 0) }]));
  return { pages: pages.map((page) => ({ id: page.id, slug: page.slug, name: page.name, connectionStatus: page.connectionStatus, aiEnabled: page.aiEnabled, telegramStatus: page.telegramSettings?.status ?? "NOT_CONFIGURED", budgetState: "HEALTHY", usage: usageByPage.get(page.id) ?? { calls: 0, totalTokens: 0, estimatedCost: 0, estimatedCostBdt: 0 } })) };
}

export async function getPages() { if (isDevPreview()) return getPreviewPages() as PreviewPage[]; return prisma.page.findMany({ orderBy: { createdAt: "asc" }, include: { _count: { select: { products: true, customers: true, conversations: true } }, settings: true, configurationVersions: { orderBy: { version: "desc" }, take: 1 } } }); }

export async function getPageById(idOrSlug: string) {
  if (isDevPreview()) return getPreviewPage(idOrSlug);
  return prisma.page.findFirst({ where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] }, include: { settings: true, connection: true, aiSettings: true, telegramSettings: true, costSettings: true, businessProfile: true, products: { include: { variants: true }, orderBy: { createdAt: "desc" } }, configurationVersions: { orderBy: { version: "desc" } }, _count: { select: { customers: true, conversations: true } } } });
}

export async function resolvePageId(idOrSlug: string) {
  const page = await getPageById(idOrSlug);
  return page?.id ?? null;
}

export async function getPageConversations(pageId: string, options: { search?: string; cursor?: string; limit?: number } = {}) {
  if (isDevPreview()) return getPreviewConversations(pageId);
  const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
  const search = options.search?.trim();
  const rows = await prisma.conversation.findMany({
    where: { pageId, ...(options.cursor ? { id: { lt: options.cursor } } : {}), ...(search ? { customer: { name: { contains: search, mode: "insensitive" } } } : {}) },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: limit + 1,
    select: { id: true, updatedAt: true, lastCustomerMessageAt: true, customer: { select: { id: true, name: true, phone: true } }, messages: { orderBy: { createdAt: "desc" }, take: 1, select: { text: true, direction: true, createdAt: true } }, _count: { select: { messages: true, outboundMessages: true } } },
  });
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  return { items, nextCursor: hasMore ? items.at(-1)?.id ?? null : null };
}
