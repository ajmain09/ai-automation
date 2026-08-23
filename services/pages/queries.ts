import { prisma } from "@/lib/db/prisma";
import { isDevPreview } from "@/lib/env";
import { getPreviewDashboard, getPreviewPage, getPreviewPages, PreviewPage } from "@/services/preview/store";

export async function getDashboardData() {
  if (isDevPreview()) return getPreviewDashboard();
  const month = new Date();
  month.setUTCDate(1); month.setUTCHours(0, 0, 0, 0);
  const [pages, usage] = await Promise.all([
    prisma.page.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.apiUsage.groupBy({ by: ["pageId"], where: { createdAt: { gte: month } }, _count: { _all: true }, _sum: { totalTokens: true, estimatedCost: true } }),
  ]);
  const usageByPage = new Map(usage.map((row) => [row.pageId, { calls: row._count._all, totalTokens: row._sum.totalTokens ?? 0, estimatedCost: Number(row._sum.estimatedCost ?? 0) }]));
  return { pages: pages.map((page) => ({ id: page.id, name: page.name, connectionStatus: page.connectionStatus, aiEnabled: page.aiEnabled, usage: usageByPage.get(page.id) ?? { calls: 0, totalTokens: 0, estimatedCost: 0 } })) };
}

export async function getPages() { if (isDevPreview()) return getPreviewPages() as PreviewPage[]; return prisma.page.findMany({ orderBy: { createdAt: "asc" }, include: { _count: { select: { products: true, customers: true, conversations: true } }, settings: true, configurationVersions: { orderBy: { version: "desc" }, take: 1 } } }); }

export async function getPageById(id: string) { if (isDevPreview()) return getPreviewPage(id); return prisma.page.findUnique({ where: { id }, include: { settings: true, connection: true, businessProfile: true, products: { include: { variants: true }, orderBy: { createdAt: "desc" } }, configurationVersions: { orderBy: { version: "desc" } }, _count: { select: { customers: true, conversations: true } } } }); }
