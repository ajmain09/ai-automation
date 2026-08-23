import { prisma } from "@/lib/db/prisma";
import { isDevPreview } from "@/lib/env";
import { getPreviewUsage } from "@/services/preview/store";

export type UsageSummary = { calls: number; inputTokens: number; outputTokens: number; totalTokens: number; estimatedCost: number };
const empty = (): UsageSummary => ({ calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0 });
function summarize(rows: Array<{ inputTokens: number; outputTokens: number; totalTokens: number; estimatedCost: unknown }>): UsageSummary { return rows.reduce<UsageSummary>((sum, row) => ({ calls: sum.calls + 1, inputTokens: sum.inputTokens + row.inputTokens, outputTokens: sum.outputTokens + row.outputTokens, totalTokens: sum.totalTokens + row.totalTokens, estimatedCost: sum.estimatedCost + Number(row.estimatedCost ?? 0) }), empty()); }
export async function getPageUsage(pageId: string, now = new Date()) {
  if (isDevPreview()) return getPreviewUsage(pageId);
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const month = new Date(now.getFullYear(), now.getMonth(), 1);
  const rows = await prisma.apiUsage.findMany({ where: { pageId, createdAt: { gte: month } }, orderBy: { createdAt: "asc" }, select: { createdAt: true, inputTokens: true, outputTokens: true, totalTokens: true, estimatedCost: true } });
  const daily = new Map<string, UsageSummary>();
  for (const row of rows) { const key = row.createdAt.toISOString().slice(0, 10); const current = daily.get(key) ?? empty(); daily.set(key, { calls: current.calls + 1, inputTokens: current.inputTokens + row.inputTokens, outputTokens: current.outputTokens + row.outputTokens, totalTokens: current.totalTokens + row.totalTokens, estimatedCost: current.estimatedCost + Number(row.estimatedCost ?? 0) }); }
  return { today: summarize(rows.filter((row) => row.createdAt >= today)), month: summarize(rows), daily: [...daily.entries()].map(([date, summary]) => ({ date, ...summary })) };
}
