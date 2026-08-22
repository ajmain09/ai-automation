import { prisma } from "@/lib/db/prisma";

export type PageScope = { pageId: string };

export function pageScope(pageId: string): PageScope {
  if (!pageId || !/^[0-9a-f-]{36}$/i.test(pageId)) throw new Error("Invalid page scope");
  return { pageId };
}

export async function requirePage(scope: PageScope) {
  const page = await prisma.page.findUnique({ where: { id: scope.pageId }, select: { id: true, metaPageId: true, aiEnabled: true, isActive: true, connectionStatus: true } });
  if (!page) throw new Error("Page not found");
  return page;
}

export function assertSamePage(...pageIds: string[]) {
  if (pageIds.some((id) => id !== pageIds[0])) throw new Error("Cross-page access denied");
}
