import { prisma } from "@/lib/db/prisma";

export async function getDashboardData() {
  const [pages, live, products] = await Promise.all([
    prisma.page.findMany({ orderBy: { createdAt: "asc" }, include: { _count: { select: { products: true } }, configurationVersions: { where: { status: "LIVE" }, take: 1 } } }),
    prisma.configurationVersion.count({ where: { status: "LIVE" } }),
    prisma.product.count(),
  ]);
  return { pages: pages.map((page) => ({ id: page.id, name: page.name, connectionStatus: page.connectionStatus, aiEnabled: page.aiEnabled, products: page._count.products, config: page.configurationVersions.length ? "Live" : "Draft" })), stats: { pages: pages.length, live, products } };
}

export async function getPages() { return prisma.page.findMany({ orderBy: { createdAt: "asc" }, include: { _count: { select: { products: true, customers: true, conversations: true } }, settings: true, configurationVersions: { orderBy: { version: "desc" }, take: 1 } } }); }

export async function getPageById(id: string) { return prisma.page.findUnique({ where: { id }, include: { settings: true, connection: true, businessProfile: true, products: { include: { variants: true }, orderBy: { createdAt: "desc" } }, configurationVersions: { orderBy: { version: "desc" } }, _count: { select: { customers: true, conversations: true } } } }); }
