import { randomUUID } from "node:crypto";
import { AiCallType } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { AiResponse, BusinessParse, aiResponseSchema, businessParseSchema } from "@/lib/validation/ai";
import { withProviderCircuit } from "@/services/resilience/retry";
import { upsertActionableIssue } from "@/services/issues/service";
import { redactSensitiveText } from "@/lib/logging/logger";
import { isDevPreview } from "@/lib/env";
import { recordPreviewUsage } from "@/services/preview/store";
import { normalizeModel } from "@/services/usage/cost";
import { calculateUsageCost } from "@/services/usage/cost";
import { decryptCredential } from "@/lib/encryption/service";
import { PageBudgetExceededError, reservePageBudgetAtomic, settlePageBudgetReservationTx } from "@/services/usage/budget";

export type ProviderUsage = { inputTokens?: number; cachedInputTokens?: number; outputTokens?: number; totalTokens?: number; raw?: unknown; requestId?: string };
export type ProviderResult = { content: string; usage?: ProviderUsage };
export interface AiProvider { readonly name: string; readonly model: string; complete(input: { system: string; user: string; callType: AiCallType }): Promise<ProviderResult>; }

export class DeepSeekProvider implements AiProvider {
  readonly name = "deepseek";
  readonly model: string;
  constructor(private readonly apiKey: string, private readonly baseUrl = "https://api.deepseek.com", model = "deepseek-v4-flash", private readonly pageScope?: string) { this.model = normalizeModel(model).model; }
  async complete(input: { system: string; user: string; callType: AiCallType }) {
    if (!this.apiKey) throw new Error("DeepSeek is not configured");
    return withProviderCircuit(this.pageScope ? `deepseek:${this.pageScope}` : "deepseek", async () => {
      const response = await fetch(`${this.baseUrl}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: this.model, temperature: 0.2, response_format: { type: "json_object" }, messages: [{ role: "system", content: input.system }, { role: "user", content: input.user }] }), signal: AbortSignal.timeout(30_000) });
      const body = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; prompt_cache_hit_tokens?: number; completion_tokens?: number; total_tokens?: number }; id?: string; error?: { message?: string } };
      if (!response.ok || body.error) throw new Error(body.error?.message ?? `DeepSeek request failed (${response.status})`);
      const content = body.choices?.[0]?.message?.content?.trim();
      if (!content) throw new Error("DeepSeek returned an empty response");
      const usage = body.usage as ({ prompt_tokens?: number; prompt_cache_hit_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined);
      return { content, usage: { inputTokens: usage?.prompt_tokens, cachedInputTokens: usage?.prompt_cache_hit_tokens, outputTokens: usage?.completion_tokens, totalTokens: usage?.total_tokens, requestId: body.id, raw: usage } };
    });
  }
}

/** Loads and decrypts exactly one Page credential inside the server boundary. */
export async function createPageDeepSeekProvider(pageId: string): Promise<DeepSeekProvider> {
  const settings = await prisma.pageAiSettings.findUnique({ where: { pageId }, select: { encryptedApiKey: true, baseUrl: true, model: true } });
  if (!settings?.encryptedApiKey) throw new Error("DeepSeek is not configured for this Page");
  return new DeepSeekProvider(decryptCredential(settings.encryptedApiKey), settings.baseUrl, settings.model, pageId);
}

export class StaticAiProvider implements AiProvider {
  readonly name = "static"; readonly model = "test";
  constructor(private readonly content: string) {}
  async complete() { return { content: this.content }; }
}

export function fallbackAiResponse(): AiResponse { return { intent: "unknown", reply: "Thanks for your message. Could you share a little more about what you need?", fact_updates: [], asked_question_key: null, recommended_product_ids: [], order_action: "NONE" }; }

type AttemptHandle = { runId: string; startedAt: number; pageId: string; reservedBdt: number; reservationKey?: string };

export async function beginProviderAttempt(input: { pageId: string; provider: AiProvider; callType: AiCallType; attemptNumber: number }): Promise<AttemptHandle> {
  if (isDevPreview()) return { runId: randomUUID(), startedAt: Date.now(), pageId: input.pageId, reservedBdt: 0 };
  const billing = await prisma.pageCostSettings.findUnique({ where: { pageId: input.pageId }, include: { pricingProfiles: { where: { model: input.provider.model }, orderBy: { effectiveFrom: "desc" }, take: 1 } } });
  const pricing = billing?.pricingProfiles[0];
  const inputRate = Number(pricing?.inputCacheMissPerMillionUsd ?? 0.3);
  const outputRate = Number(pricing?.outputPerMillionUsd ?? 1.1);
  const usdBdtRate = Number(billing?.usdBdtRate ?? 120);
  const reservedBdt = (1000 / 1_000_000 * inputRate + 700 / 1_000_000 * outputRate) * usdBdtRate;
  const reservationKey = randomUUID();
  await reservePageBudgetAtomic(input.pageId, reservedBdt, reservationKey);
  const run = await prisma.$transaction(async (tx) => {
    const created = await tx.aiRun.create({ data: { pageId: input.pageId, attemptId: reservationKey, provider: input.provider.name, model: input.provider.model, callType: input.callType, status: "RUNNING", attemptNumber: input.attemptNumber } });
    await tx.aiBudgetReservation.update({ where: { reservationKey }, data: { aiAttemptId: created.id } });
    await tx.apiUsage.create({ data: { pageId: input.pageId, aiAttemptId: created.id, provider: input.provider.name, model: input.provider.model, callType: input.callType, inputRateSnapshot: inputRate, inputHitRateSnapshot: Number(pricing?.inputCacheHitPerMillionUsd ?? inputRate), inputMissRateSnapshot: inputRate, outputRateSnapshot: outputRate, usdBdtRateSnapshot: usdBdtRate, attemptNumber: input.attemptNumber, status: "RUNNING" } });
    return created;
  });
  return { runId: run.id, startedAt: Date.now(), pageId: input.pageId, reservedBdt, reservationKey };
}

export async function finishProviderAttempt(input: { handle: AttemptHandle; usage?: ProviderUsage; status: string; error?: string }) {
  const duration = Date.now() - input.handle.startedAt;
  const inputTokens = input.usage?.inputTokens ?? 0;
  const outputTokens = input.usage?.outputTokens ?? 0;
  const totalTokens = input.usage?.totalTokens ?? inputTokens + outputTokens;
  if (isDevPreview()) {
    recordPreviewUsage(input.handle.pageId, inputTokens, outputTokens, 0);
    return null;
  }
  return prisma.$transaction(async (tx) => {
    const existing = await tx.apiUsage.findUniqueOrThrow({ where: { aiAttemptId: input.handle.runId }, select: { inputHitRateSnapshot: true, inputMissRateSnapshot: true, outputRateSnapshot: true, usdBdtRateSnapshot: true } });
    const cost = calculateUsageCost({ inputTokens, cachedInputTokens: input.usage?.cachedInputTokens, outputTokens, inputCacheHitRateUsd: Number(existing.inputHitRateSnapshot ?? 0), inputCacheMissRateUsd: Number(existing.inputMissRateSnapshot ?? 0), outputRateUsd: Number(existing.outputRateSnapshot ?? 0), usdBdtRate: Number(existing.usdBdtRateSnapshot ?? 120) });
    await tx.aiRun.update({ where: { id: input.handle.runId }, data: { status: input.status, inputTokens, cachedInputTokens: input.usage?.cachedInputTokens, outputTokens, totalTokens, providerUsageJson: input.usage?.raw as never, latencyMs: duration, providerRequestId: input.usage?.requestId, errorCode: input.error?.slice(0, 120) } });
    const result = await tx.apiUsage.update({ where: { aiAttemptId: input.handle.runId }, data: { inputTokens, cachedInputTokens: input.usage?.cachedInputTokens, outputTokens, totalTokens, providerUsageJson: input.usage?.raw as never, estimatedCost: cost.totalUsd, estimatedCostUsd: cost.totalUsd, estimatedCostBdt: cost.totalBdt, costEstimated: cost.estimated, providerRequestId: input.usage?.requestId, status: input.status, latencyMs: duration } });
    await settlePageBudgetReservationTx(tx, { pageId: input.handle.pageId, reservationKey: input.handle.reservationKey, actualBdt: cost.totalBdt, success: input.status === "SUCCEEDED" });
    return result;
  });
}

export async function recordProviderAttempt(input: { pageId: string; provider: AiProvider; callType: AiCallType; attemptNumber: number; startedAt: number; usage?: ProviderUsage; status: string; error?: string }) {
  const handle = await beginProviderAttempt({ pageId: input.pageId, provider: input.provider, callType: input.callType, attemptNumber: input.attemptNumber });
  return finishProviderAttempt({ handle: { ...handle, startedAt: input.startedAt }, usage: input.usage, status: input.status, error: input.error });
}

export async function runStructuredAi<T extends AiResponse | BusinessParse>(input: { pageId: string; provider: AiProvider; callType: AiCallType; system: string; user: string; schema: typeof aiResponseSchema | typeof businessParseSchema; fallback: T }) {
  let lastError: string | undefined;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const startedAt = Date.now();
    let handle: AttemptHandle | undefined;
    try {
      handle = await beginProviderAttempt({ pageId: input.pageId, provider: input.provider, callType: attempt === 1 ? input.callType : "RETRY", attemptNumber: attempt });
      const result = await input.provider.complete({ system: input.system, user: attempt === 1 ? input.user : `${input.user}\nReturn ONLY valid JSON matching the requested schema. Do not add markdown.`, callType: attempt === 1 ? input.callType : "RETRY" });
      const parsed = input.schema.safeParse(JSON.parse(result.content));
      if (parsed.success) { await finishProviderAttempt({ handle: { ...handle, startedAt }, usage: result.usage, status: "SUCCEEDED" }); return parsed.data as T; }
      lastError = "Malformed structured AI output";
      await finishProviderAttempt({ handle: { ...handle, startedAt }, usage: result.usage, status: "FAILED", error: lastError });
    } catch (error) { if (error instanceof PageBudgetExceededError) return input.fallback; lastError = redactSensitiveText(error instanceof Error ? error.message : "AI provider failure"); if (handle) await finishProviderAttempt({ handle: { ...handle, startedAt }, status: "FAILED", error: lastError }); else await recordProviderAttempt({ pageId: input.pageId, provider: input.provider, callType: attempt === 1 ? input.callType : "RETRY", attemptNumber: attempt, startedAt, status: "FAILED", error: lastError }); }
  }
  if (lastError) await upsertActionableIssue({ pageId: input.pageId, type: "AI_PROVIDER", title: "AI provider failed", description: lastError.slice(0, 500), severity: "high", resolutionAction: "Check provider credentials, circuit state, and rate configuration." });
  return input.fallback;
}
