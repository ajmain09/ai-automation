import { prisma } from "@/lib/db/prisma";
import { aiResponseSchema } from "@/lib/validation/ai";
import { buildBoundedContext } from "@/services/ai/context";
import { createPageDeepSeekProvider, fallbackAiResponse, runStructuredAi, type AiProvider } from "@/services/ai/provider";
import { applyFactUpdates, emptyMemory, markQuestionAsked, memorySchema, updateCustomerMemory } from "@/services/memory/service";
import { retrieveRelevantProducts } from "@/services/products/retrieval";
import { validateReferencedProducts } from "@/services/products/validation";
import { sendSafeReply } from "@/services/messaging/outbound";
import { QueueJob } from "@/services/jobs/queue";
import { applyOrderSignal } from "@/services/orders/conversation";

const jobPayload = (value: unknown) => {
  if (!value || typeof value !== "object") throw new Error("Invalid conversation job payload");
  const data = value as { conversationId?: unknown; version?: unknown };
  if (typeof data.conversationId !== "string") throw new Error("Missing conversation id");
  return { conversationId: data.conversationId, version: typeof data.version === "number" ? data.version : undefined };
};

export async function processConversationJob(job: QueueJob, provider?: AiProvider) {
  const input = jobPayload(job.payload);
  if (job.expiresAt && job.expiresAt <= new Date()) return;
  const conversation = await prisma.conversation.findFirst({ where: { id: input.conversationId, pageId: job.pageId }, include: { customer: { include: { memory: true } }, messages: { orderBy: { createdAt: "desc" }, take: 20 }, page: { include: { businessProfile: true, settings: true, aiSettings: true } } } });
  if (!conversation || !conversation.customer || !job.pageId) throw new Error("Conversation/page scope not found");
  if (!conversation.page.aiEnabled || conversation.page.aiStatus === "PAUSED_BY_BUDGET") return;
  if (input.version !== undefined && input.version !== conversation.version) return;
  const newest = conversation.messages.find((message) => message.direction === "INBOUND");
  if (!newest) return;
  if (!newest.text && newest.metadata && typeof newest.metadata === "object") {
    await sendSafeReply({ pageId: job.pageId, conversationId: conversation.id, recipientPsid: conversation.customer.facebookPsid, text: "I can’t inspect images, voice, or video yet. Please describe your question or problem in text.", generatedVersion: conversation.version, jobExpiresAt: job.expiresAt, outboundAttemptKey: `attachment-fallback:${job.id}:${conversation.version}` });
    return;
  }
  if (!newest.text) return;
  const memory = memorySchema.parse(conversation.customer.memory?.memory ?? emptyMemory());
  const activeOrder = await prisma.orderSession.findFirst({ where: { pageId: job.pageId, customerId: conversation.customer.id, status: "ACTIVE" }, orderBy: { updatedAt: "desc" }, select: { id: true, state: true, status: true } });
  const products = await retrieveRelevantProducts(job.pageId, `${newest.text} ${JSON.stringify(memory.needs)} ${JSON.stringify(memory.knownFacts)}`);
  const policies = JSON.stringify({ business: conversation.page.businessProfile, settings: conversation.page.settings });
  const context = buildBoundedContext({ rules: `Never invent products, prices, policies, stock, or order state. Use semantic question keys and do not repeat complete facts. Return only the JSON schema. Page language: ${conversation.page.aiSettings?.language ?? "auto"}. Tone: ${conversation.page.aiSettings?.tone ?? "natural_sales"}. Reply length: ${conversation.page.aiSettings?.replyLength ?? "short"}. Custom sales instructions: ${conversation.page.aiSettings?.customSalesInstructions ?? "none"}.`, policies, products, memory, orderState: activeOrder ? { orderSessionId: activeOrder.id, status: activeOrder.status, ...(activeOrder.state as Record<string, unknown>) } : null, summary: memory.summary, recentMessages: conversation.messages.slice(0, conversation.page.aiSettings?.recentMessageContext ?? 10).reverse().map((message) => `${message.direction}: ${message.text ?? ""}`), newestMessage: newest.text });
  const activeProvider = provider ?? await createPageDeepSeekProvider(job.pageId);
  const result = await runStructuredAi({ pageId: job.pageId, provider: activeProvider, callType: "CHAT_REPLY", system: "You are a careful sales assistant. Candidate facts are not authoritative until the backend validates them.", user: context, schema: aiResponseSchema, fallback: fallbackAiResponse() });
  const effectiveResult = { ...result, recommended_product_ids: result.recommended_product_ids.slice(0, conversation.page.aiSettings?.maxProductsPerRecommendation ?? 1) };
  const fresh = await prisma.conversation.findFirst({ where: { id: conversation.id, pageId: job.pageId }, select: { version: true, manualReplyUntil: true } });
  if (!fresh) return;
  if (fresh.version !== conversation.version || (fresh.manualReplyUntil && fresh.manualReplyUntil > new Date())) return;
  await validateReferencedProducts(job.pageId, effectiveResult.recommended_product_ids);
  const liveConfiguration = await prisma.configurationVersion.findFirst({ where: { pageId: job.pageId, status: "LIVE" }, select: { version: true } });
  const orderResult = await applyOrderSignal({ pageId: job.pageId, customerId: conversation.customer.id, text: newest.text, result: effectiveResult, requiredFields: Array.isArray(conversation.page.settings?.requiredOrderFields) ? conversation.page.settings.requiredOrderFields.map(String) : ["name", "phone", "address", "product", "variant", "quantity"], currency: conversation.page.settings?.currency ?? "BDT", countryCode: conversation.page.settings?.countryCode ?? "BD", configurationVersion: liveConfiguration?.version });
  const orderSessionAfter = await prisma.orderSession.findFirst({ where: { pageId: job.pageId, customerId: conversation.customer.id, status: "ACTIVE" }, orderBy: { updatedAt: "desc" }, select: { id: true } });
  const completedOrderAfter = await prisma.orderSession.findFirst({ where: { pageId: job.pageId, customerId: conversation.customer.id, status: "COMPLETED", orderId: { not: null } }, orderBy: { updatedAt: "desc" }, select: { orderId: true } });
  const orderMemoryUpdate = { key: "active_order_session_id", value: orderSessionAfter?.id ?? completedOrderAfter?.orderId ?? null, operation: orderSessionAfter || completedOrderAfter ? "SET" as const : "CLEAR" as const, confidence: 1 };
  const memoryUpdates = [...effectiveResult.fact_updates, orderMemoryUpdate];
  const updatedMemory = markQuestionAsked(applyFactUpdates(memory, memoryUpdates), effectiveResult.asked_question_key);
  if (memoryUpdates.length || effectiveResult.asked_question_key) await updateCustomerMemory({ pageId: job.pageId, customerId: conversation.customer.id, updates: memoryUpdates, askedQuestionKey: effectiveResult.asked_question_key, sourceMessageId: newest.id, countryCode: conversation.page.settings?.countryCode ?? "BD" });
  void updatedMemory;
  await sendSafeReply({ pageId: job.pageId, conversationId: conversation.id, recipientPsid: conversation.customer.facebookPsid, text: orderResult?.reply ?? effectiveResult.reply, generatedVersion: conversation.version, generatedConfigurationVersion: liveConfiguration?.version, jobExpiresAt: job.expiresAt, outboundAttemptKey: `reply:${job.id}:${conversation.version}` });
}
