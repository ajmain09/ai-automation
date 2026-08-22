import { randomUUID } from "node:crypto";
import { getEnv } from "@/lib/env";
import { AiCallType } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { AiResponse, BusinessParse, aiResponseSchema, businessParseSchema } from "@/lib/validation/ai";

export type ProviderUsage = { inputTokens?: number; outputTokens?: number; totalTokens?: number; raw?: unknown; requestId?: string };
export type ProviderResult = { content: string; usage?: ProviderUsage };
export interface AiProvider { readonly name: string; readonly model: string; complete(input: { system: string; user: string; callType: AiCallType }): Promise<ProviderResult>; }

export class DeepSeekProvider implements AiProvider {
  readonly name = "deepseek";
  readonly model: string;
  constructor(private readonly apiKey = getEnv().DEEPSEEK_API_KEY, private readonly baseUrl = getEnv().DEEPSEEK_BASE_URL) { this.model = getEnv().DEEPSEEK_MODEL; }
  async complete(input: { system: string; user: string; callType: AiCallType }) {
    if (!this.apiKey) throw new Error("DeepSeek is not configured");
    const response = await fetch(`${this.baseUrl}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: this.model, temperature: 0.2, response_format: { type: "json_object" }, messages: [{ role: "system", content: input.system }, { role: "user", content: input.user }] }), signal: AbortSignal.timeout(30_000) });
    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }; id?: string; error?: { message?: string } };
    if (!response.ok || body.error) throw new Error(body.error?.message ?? "DeepSeek request failed");
    const content = body.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error("DeepSeek returned an empty response");
    return { content, usage: { inputTokens: body.usage?.prompt_tokens, outputTokens: body.usage?.completion_tokens, totalTokens: body.usage?.total_tokens, requestId: body.id, raw: body.usage } };
  }
}

export class StaticAiProvider implements AiProvider {
  readonly name = "static"; readonly model = "test";
  constructor(private readonly content: string) {}
  async complete() { return { content: this.content }; }
}

export function fallbackAiResponse(): AiResponse { return { intent: "unknown", reply: "Thanks for your message. Could you share a little more about what you need?", fact_updates: [], asked_question_key: null, recommended_product_ids: [], order_action: "NONE" }; }

export async function recordProviderAttempt(input: { pageId: string; provider: AiProvider; callType: AiCallType; attemptNumber: number; startedAt: number; usage?: ProviderUsage; status: string; error?: string }) {
  const duration = Date.now() - input.startedAt;
  const inputTokens = input.usage?.inputTokens ?? 0;
  const outputTokens = input.usage?.outputTokens ?? 0;
  const totalTokens = input.usage?.totalTokens ?? inputTokens + outputTokens;
  const env = getEnv();
  return prisma.$transaction(async (tx) => {
    const run = await tx.aiRun.create({ data: { pageId: input.pageId, attemptId: randomUUID(), provider: input.provider.name, model: input.provider.model, callType: input.callType, status: input.status, inputTokens, outputTokens, totalTokens, latencyMs: duration, providerRequestId: input.usage?.requestId, attemptNumber: input.attemptNumber, errorCode: input.error?.slice(0, 120) } });
    const inputRate = env.DEEPSEEK_INPUT_RATE;
    const outputRate = env.DEEPSEEK_OUTPUT_RATE;
    const estimatedCost = inputTokens * inputRate + outputTokens * outputRate;
    await tx.apiUsage.create({ data: { pageId: input.pageId, aiAttemptId: run.id, provider: input.provider.name, model: input.provider.model, callType: input.callType, inputTokens, outputTokens, totalTokens, providerUsageJson: input.usage?.raw as never, inputRateSnapshot: inputRate, outputRateSnapshot: outputRate, estimatedCost, providerRequestId: input.usage?.requestId, attemptNumber: input.attemptNumber, status: input.status, latencyMs: duration } });
    return run;
  });
}

export async function runStructuredAi<T extends AiResponse | BusinessParse>(input: { pageId: string; provider: AiProvider; callType: AiCallType; system: string; user: string; schema: typeof aiResponseSchema | typeof businessParseSchema; fallback: T }) {
  let lastError: string | undefined;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const startedAt = Date.now();
    try {
      const result = await input.provider.complete({ system: input.system, user: attempt === 1 ? input.user : `${input.user}\nReturn ONLY valid JSON matching the requested schema. Do not add markdown.`, callType: attempt === 1 ? input.callType : "RETRY" });
      await recordProviderAttempt({ pageId: input.pageId, provider: input.provider, callType: attempt === 1 ? input.callType : "RETRY", attemptNumber: attempt, startedAt, usage: result.usage, status: "SUCCEEDED" });
      const parsed = input.schema.safeParse(JSON.parse(result.content));
      if (parsed.success) return parsed.data as T;
      lastError = "Malformed structured AI output";
    } catch (error) { lastError = error instanceof Error ? error.message : "AI provider failure"; await recordProviderAttempt({ pageId: input.pageId, provider: input.provider, callType: attempt === 1 ? input.callType : "RETRY", attemptNumber: attempt, startedAt, status: "FAILED", error: lastError }); }
  }
  void lastError;
  return input.fallback;
}
