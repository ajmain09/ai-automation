import { randomUUID } from "node:crypto";
import { getEnv } from "@/lib/env";
import { AiCallType } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { AiResponse, BusinessParse, aiResponseSchema, businessParseSchema } from "@/lib/validation/ai";
import { withProviderCircuit } from "@/services/resilience/retry";
import { upsertActionableIssue } from "@/services/issues/service";
import { redactSensitiveText } from "@/lib/logging/logger";
import { isDevPreview } from "@/lib/env";
import { recordPreviewUsage } from "@/services/preview/store";

export type ProviderUsage = { inputTokens?: number; outputTokens?: number; totalTokens?: number; raw?: unknown; requestId?: string };
export type ProviderResult = { content: string; usage?: ProviderUsage };
export interface AiProvider { readonly name: string; readonly model: string; complete(input: { system: string; user: string; callType: AiCallType }): Promise<ProviderResult>; }

export class DeepSeekProvider implements AiProvider {
  readonly name = "deepseek";
  readonly model: string;
  constructor(private readonly apiKey = getEnv().DEEPSEEK_API_KEY, private readonly baseUrl = getEnv().DEEPSEEK_BASE_URL) { this.model = getEnv().DEEPSEEK_MODEL; }
  async complete(input: { system: string; user: string; callType: AiCallType }) {
    if (!this.apiKey) throw new Error("DeepSeek is not configured");
    return withProviderCircuit("deepseek", async () => {
      const response = await fetch(`${this.baseUrl}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: this.model, temperature: 0.2, response_format: { type: "json_object" }, messages: [{ role: "system", content: input.system }, { role: "user", content: input.user }] }), signal: AbortSignal.timeout(30_000) });
      const body = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }; id?: string; error?: { message?: string } };
      if (!response.ok || body.error) throw new Error(body.error?.message ?? `DeepSeek request failed (${response.status})`);
      const content = body.choices?.[0]?.message?.content?.trim();
      if (!content) throw new Error("DeepSeek returned an empty response");
      return { content, usage: { inputTokens: body.usage?.prompt_tokens, outputTokens: body.usage?.completion_tokens, totalTokens: body.usage?.total_tokens, requestId: body.id, raw: body.usage } };
    });
  }
}

export class StaticAiProvider implements AiProvider {
  readonly name = "static"; readonly model = "test";
  constructor(private readonly content: string) {}
  async complete() { return { content: this.content }; }
}

export function fallbackAiResponse(): AiResponse { return { intent: "unknown", reply: "Thanks for your message. Could you share a little more about what you need?", fact_updates: [], asked_question_key: null, recommended_product_ids: [], order_action: "NONE" }; }

type AttemptHandle = { runId: string; startedAt: number; pageId: string };

export async function beginProviderAttempt(input: { pageId: string; provider: AiProvider; callType: AiCallType; attemptNumber: number }): Promise<AttemptHandle> {
  if (isDevPreview()) return { runId: randomUUID(), startedAt: Date.now(), pageId: input.pageId };
  const env = getEnv();
  const run = await prisma.$transaction(async (tx) => {
    const created = await tx.aiRun.create({ data: { pageId: input.pageId, attemptId: randomUUID(), provider: input.provider.name, model: input.provider.model, callType: input.callType, status: "RUNNING", attemptNumber: input.attemptNumber } });
    await tx.apiUsage.create({ data: { pageId: input.pageId, aiAttemptId: created.id, provider: input.provider.name, model: input.provider.model, callType: input.callType, inputRateSnapshot: env.DEEPSEEK_INPUT_RATE, outputRateSnapshot: env.DEEPSEEK_OUTPUT_RATE, attemptNumber: input.attemptNumber, status: "RUNNING" } });
    return created;
  });
  return { runId: run.id, startedAt: Date.now(), pageId: input.pageId };
}

export async function finishProviderAttempt(input: { handle: AttemptHandle; usage?: ProviderUsage; status: string; error?: string }) {
  const duration = Date.now() - input.handle.startedAt;
  const inputTokens = input.usage?.inputTokens ?? 0;
  const outputTokens = input.usage?.outputTokens ?? 0;
  const totalTokens = input.usage?.totalTokens ?? inputTokens + outputTokens;
  const env = getEnv();
  if (isDevPreview()) {
    recordPreviewUsage(input.handle.pageId, inputTokens, outputTokens, inputTokens * env.DEEPSEEK_INPUT_RATE + outputTokens * env.DEEPSEEK_OUTPUT_RATE);
    return null;
  }
  return prisma.$transaction(async (tx) => {
    const estimatedCost = inputTokens * env.DEEPSEEK_INPUT_RATE + outputTokens * env.DEEPSEEK_OUTPUT_RATE;
    await tx.aiRun.update({ where: { id: input.handle.runId }, data: { status: input.status, inputTokens, outputTokens, totalTokens, latencyMs: duration, providerRequestId: input.usage?.requestId, errorCode: input.error?.slice(0, 120) } });
    return tx.apiUsage.update({ where: { aiAttemptId: input.handle.runId }, data: { inputTokens, outputTokens, totalTokens, providerUsageJson: input.usage?.raw as never, estimatedCost, providerRequestId: input.usage?.requestId, status: input.status, latencyMs: duration } });
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
    } catch (error) { lastError = redactSensitiveText(error instanceof Error ? error.message : "AI provider failure"); if (handle) await finishProviderAttempt({ handle: { ...handle, startedAt }, status: "FAILED", error: lastError }); else await recordProviderAttempt({ pageId: input.pageId, provider: input.provider, callType: attempt === 1 ? input.callType : "RETRY", attemptNumber: attempt, startedAt, status: "FAILED", error: lastError }); }
  }
  if (lastError) await upsertActionableIssue({ pageId: input.pageId, type: "AI_PROVIDER", title: "AI provider failed", description: lastError.slice(0, 500), severity: "high", resolutionAction: "Check provider credentials, circuit state, and rate configuration." });
  return input.fallback;
}
