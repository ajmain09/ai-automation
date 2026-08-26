import { prisma } from "@/lib/db/prisma";
import { isDevPreview } from "@/lib/env";
import { getPreviewUsage } from "@/services/preview/store";
import { dhakaDateKey, startOfDhakaDay, startOfDhakaMonth } from "@/services/time/timezone";

export type UsageSummary = { calls: number; inputTokens: number; cachedInputTokens: number; outputTokens: number; totalTokens: number; estimatedCost: number; estimatedCostUsd: number; estimatedCostBdt: number };
const empty = (): UsageSummary => ({ calls: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0, estimatedCostUsd: 0, estimatedCostBdt: 0 });
function summarize(rows: Array<{ inputTokens: number; cachedInputTokens: number | null; outputTokens: number; totalTokens: number; estimatedCost: unknown; estimatedCostUsd: unknown; estimatedCostBdt: unknown }>): UsageSummary { return rows.reduce<UsageSummary>((sum, row) => ({ calls: sum.calls + 1, inputTokens: sum.inputTokens + row.inputTokens, cachedInputTokens: sum.cachedInputTokens + (row.cachedInputTokens ?? 0), outputTokens: sum.outputTokens + row.outputTokens, totalTokens: sum.totalTokens + row.totalTokens, estimatedCost: sum.estimatedCost + Number(row.estimatedCost ?? 0), estimatedCostUsd: sum.estimatedCostUsd + Number(row.estimatedCostUsd ?? row.estimatedCost ?? 0), estimatedCostBdt: sum.estimatedCostBdt + Number(row.estimatedCostBdt ?? 0) }), empty()); }
export async function getPageUsage(pageId: string, now = new Date()) {
  if (isDevPreview()) return getPreviewUsage(pageId);
  const today = startOfDhakaDay(now);
  const month = startOfDhakaMonth(now);
  const rows = await prisma.apiUsage.findMany({ where: { pageId, createdAt: { gte: month } }, orderBy: { createdAt: "asc" }, select: { createdAt: true, inputTokens: true, cachedInputTokens: true, outputTokens: true, totalTokens: true, estimatedCost: true, estimatedCostUsd: true, estimatedCostBdt: true } });
  const daily = new Map<string, UsageSummary>();
  for (const row of rows) { const key = dhakaDateKey(row.createdAt); const current = daily.get(key) ?? empty(); daily.set(key, { ...current, calls: current.calls + 1, inputTokens: current.inputTokens + row.inputTokens, cachedInputTokens: current.cachedInputTokens + (row.cachedInputTokens ?? 0), outputTokens: current.outputTokens + row.outputTokens, totalTokens: current.totalTokens + row.totalTokens, estimatedCost: current.estimatedCost + Number(row.estimatedCost ?? 0), estimatedCostUsd: current.estimatedCostUsd + Number(row.estimatedCostUsd ?? row.estimatedCost ?? 0), estimatedCostBdt: current.estimatedCostBdt + Number(row.estimatedCostBdt ?? 0) }); }
  return { today: summarize(rows.filter((row) => row.createdAt >= today)), month: summarize(rows), daily: [...daily.entries()].map(([date, summary]) => ({ date, ...summary })) };
}
