import { prisma } from "@/lib/db/prisma";
import { aiResponseSchema } from "@/lib/validation/ai";
import { buildBoundedContext } from "@/services/ai/context";
import { DeepSeekProvider, fallbackAiResponse, runStructuredAi } from "@/services/ai/provider";
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

export async function processConversationJob(job: QueueJob, provider = new DeepSeekProvider()) {
  const input = jobPayload(job.payload);
  if (job.expiresAt && job.expiresAt <= new Date()) return;
  const conversation = await prisma.conversation.findFirst({ where: { id: input.conversationId, pageId: job.pageId }, include: { customer: { include: { memory: true } }, messages: { orderBy: { createdAt: "desc" }, take: 20 }, page: { include: { businessProfile: true, settings: true } } } });
  if (!conversation || !conversation.customer || !job.pageId) throw new Error("Conversation/page scope not found");
  const globalSetting = await prisma.systemSetting.findUnique({ where: { key: "global_ai_paused" } });
  if (globalSetting?.value === true || !conversation.page.aiEnabled || conversation.page.settings?.globalAiPaused) return;
  if (input.version !== undefined && input.version !== conversation.version) return;
  const newest = conversation.messages.find((message) => message.direction === "INBOUND");
  if (!newest) return;
  if (!newest.text && newest.metadata && typeof newest.metadata === "object") {
    await sendSafeReply({ pageId: job.pageId, conversationId: conversation.id, recipientPsid: conversation.customer.facebookPsid, text: "I can’t inspect images, voice, or video yet. Please describe your question or problem in text.", generatedVersion: conversation.version, jobExpiresAt: job.expiresAt, outboundAttemptKey: `attachment-fallback:${job.id}:${conversation.version}` });
    return;
  }
  if (!newest.text) return;
  const memory = memorySchema.parse(conversation.customer.memory?.memory ?? emptyMemory());
  const products = await retrieveRelevantProducts(job.pageId, `${newest.text} ${JSON.stringify(memory.needs)} ${JSON.stringify(memory.knownFacts)}`);
  const policies = JSON.stringify({ business: conversation.page.businessProfile, settings: conversation.page.settings });
  const context = buildBoundedContext({ rules: "Never invent products, prices, policies, stock, or order state. Use semantic question keys and do not repeat complete facts. Return only the JSON schema.", policies, products, memory, orderState: null, summary: memory.summary, recentMessages: conversation.messages.slice(0, 10).reverse().map((message) => `${message.direction}: ${message.text ?? ""}`), newestMessage: newest.text });
  const result = await runStructuredAi({ pageId: job.pageId, provider, callType: "CHAT_REPLY", system: "You are a careful sales assistant. Candidate facts are not authoritative until the backend validates them.", user: context, schema: aiResponseSchema, fallback: fallbackAiResponse() });
  const fresh = await prisma.conversation.findFirst({ where: { id: conversation.id, pageId: job.pageId }, select: { version: true, manualReplyUntil: true } });
  if (!fresh) return;
  if (fresh.version !== conversation.version || (fresh.manualReplyUntil && fresh.manualReplyUntil > new Date())) return;
  await validateReferencedProducts(job.pageId, result.recommended_product_ids);
  const liveConfiguration = await prisma.configurationVersion.findFirst({ where: { pageId: job.pageId, status: "LIVE" }, select: { version: true } });
  const orderResult = await applyOrderSignal({ pageId: job.pageId, customerId: conversation.customer.id, text: newest.text, result, requiredFields: Array.isArray(conversation.page.settings?.requiredOrderFields) ? conversation.page.settings.requiredOrderFields.map(String) : ["name", "phone", "address", "product", "variant", "quantity"], currency: conversation.page.settings?.currency ?? "USD", countryCode: conversation.page.settings?.countryCode ?? "US", configurationVersion: liveConfiguration?.version });
  const updatedMemory = markQuestionAsked(applyFactUpdates(memory, result.fact_updates), result.asked_question_key);
  if (result.fact_updates.length || result.asked_question_key) await updateCustomerMemory({ pageId: job.pageId, customerId: conversation.customer.id, updates: result.fact_updates, askedQuestionKey: result.asked_question_key, countryCode: conversation.page.settings?.countryCode ?? "US" });
  void updatedMemory;
  await sendSafeReply({ pageId: job.pageId, conversationId: conversation.id, recipientPsid: conversation.customer.facebookPsid, text: orderResult?.reply ?? result.reply, generatedVersion: conversation.version, jobExpiresAt: job.expiresAt, outboundAttemptKey: `reply:${job.id}:${conversation.version}` });
}
