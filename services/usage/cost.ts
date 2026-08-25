export type UsageCostInput = {
  inputTokens: number;
  cachedInputTokens?: number | null;
  outputTokens: number;
  inputCacheHitRateUsd: number;
  inputCacheMissRateUsd: number;
  outputRateUsd: number;
  usdBdtRate: number;
};

export type UsageCost = {
  cachedInputCostUsd: number;
  uncachedInputCostUsd: number;
  outputCostUsd: number;
  totalUsd: number;
  totalBdt: number;
  estimated: boolean;
};

export function calculateUsageCost(input: UsageCostInput): UsageCost {
  const inputTokens = Math.max(0, input.inputTokens);
  const outputTokens = Math.max(0, input.outputTokens);
  const hasCacheDetail = input.cachedInputTokens !== null && input.cachedInputTokens !== undefined;
  const cachedTokens = Math.min(inputTokens, Math.max(0, input.cachedInputTokens ?? 0));
  const uncachedTokens = hasCacheDetail ? inputTokens - cachedTokens : inputTokens;
  const cachedInputCostUsd = cachedTokens / 1_000_000 * input.inputCacheHitRateUsd;
  const uncachedInputCostUsd = uncachedTokens / 1_000_000 * input.inputCacheMissRateUsd;
  const outputCostUsd = outputTokens / 1_000_000 * input.outputRateUsd;
  const totalUsd = cachedInputCostUsd + uncachedInputCostUsd + outputCostUsd;
  return { cachedInputCostUsd, uncachedInputCostUsd, outputCostUsd, totalUsd, totalBdt: totalUsd * input.usdBdtRate, estimated: !hasCacheDetail };
}

export function normalizeModel(model: string | null | undefined, thinking = false) {
  if (model === "deepseek-chat") return { model: "deepseek-v4-flash", thinking: false };
  if (model === "deepseek-reasoner") return { model: "deepseek-v4-flash", thinking: true };
  return { model: model || "deepseek-v4-flash", thinking };
}

export function budgetState(input: { usedBdt: number; budgetBdt?: number | null; warningThreshold: number; paused?: boolean }) {
  if (input.paused) return "PAUSED_BY_BUDGET" as const;
  if (!input.budgetBdt || input.budgetBdt <= 0) return "HEALTHY" as const;
  if (input.usedBdt >= input.budgetBdt) return "LIMIT_REACHED" as const;
  const threshold = input.warningThreshold > 1 ? input.warningThreshold / 100 : input.warningThreshold;
  if (input.usedBdt >= input.budgetBdt * threshold) return "WARNING" as const;
  return "HEALTHY" as const;
}
