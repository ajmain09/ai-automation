import { prisma } from "@/lib/db/prisma";
import { decryptCredential } from "@/lib/encryption/service";
import { sendMetaMessage } from "@/services/meta/service";
import { canSendReply } from "@/services/messaging/version";

export async function sendSafeReply(input: { pageId: string; conversationId: string; recipientPsid: string; text: string; generatedVersion: number; jobExpiresAt?: Date | null; outboundAttemptKey: string }) {
  const existing = await prisma.outboundMessage.findUnique({ where: { outboundAttemptKey: input.outboundAttemptKey } });
  if (existing) return existing;
  const global = await prisma.systemSetting.findUnique({ where: { key: "global_ai_paused" } });
  const state = await prisma.conversation.findFirst({ where: { id: input.conversationId, pageId: input.pageId }, include: { page: { include: { connection: true, settings: true } } } });
  if (!state) throw new Error("Conversation not found in page scope");
  const paused = global?.value === true || state.page.settings?.globalAiPaused || !state.page.aiEnabled || state.page.connectionStatus !== "CONNECTED";
  const check = canSendReply({ generatedVersion: input.generatedVersion, currentVersion: state.version, manualReplyUntil: state.manualReplyUntil, expiresAt: input.jobExpiresAt });
  const payload = { recipient: input.recipientPsid, text: input.text };
  const outbound = await prisma.outboundMessage.create({ data: { pageId: input.pageId, conversationId: input.conversationId, outboundAttemptKey: input.outboundAttemptKey, payload, status: paused || !check.ok ? "FAILED_PERMANENT" : "PENDING", lastError: paused ? "AI paused" : check.ok ? null : check.reason } });
  if (paused || !check.ok) return outbound;
  if (!state.page.connection?.encryptedToken) return prisma.outboundMessage.update({ where: { id: outbound.id }, data: { status: "FAILED_PERMANENT", lastError: "Meta connection credential missing" } });
  await prisma.outboundMessage.update({ where: { id: outbound.id }, data: { status: "SENDING" } });
  try {
    const result = await sendMetaMessage(decryptCredential(state.page.connection.encryptedToken), input.recipientPsid, input.text);
    return prisma.outboundMessage.update({ where: { id: outbound.id }, data: { status: "SENT", providerMessageId: result.message_id, sentAt: new Date() } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Meta send failed";
    const unknown = /timeout|abort|timed out/i.test(message);
    return prisma.outboundMessage.update({ where: { id: outbound.id }, data: { status: unknown ? "UNKNOWN_DELIVERY" : "FAILED_RETRYABLE", lastError: message.slice(0, 500) } });
  }
}
