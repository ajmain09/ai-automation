import { prisma } from "@/lib/db/prisma";
import { decryptCredential } from "@/lib/encryption/service";
import { sendMetaMessage } from "@/services/meta/service";
import { canSendReply } from "@/services/messaging/version";
import { classifyFailure } from "@/services/resilience/retry";
import { upsertActionableIssue } from "@/services/issues/service";
import { Prisma } from "@prisma/client";
import { backoffWithJitter } from "@/services/resilience/retry";

export async function sendSafeReply(input: { pageId: string; conversationId: string; recipientPsid: string; text: string; generatedVersion: number; generatedConfigurationVersion?: number; jobExpiresAt?: Date | null; outboundAttemptKey: string }) {
  const existing = await prisma.outboundMessage.findUnique({ where: { outboundAttemptKey: input.outboundAttemptKey } });
  if (existing) return existing;
  const state = await prisma.conversation.findFirst({ where: { id: input.conversationId, pageId: input.pageId }, include: { page: { include: { connection: true, settings: true, aiSettings: true } } } });
  if (!state) throw new Error("Conversation not found in page scope");
  const paused = !state.page.isActive || !state.page.aiEnabled || state.page.aiStatus === "PAUSED_BY_BUDGET" || state.page.connectionStatus !== "CONNECTED";
  const check = canSendReply({ generatedVersion: input.generatedVersion, currentVersion: state.version, manualReplyUntil: state.page.aiSettings?.manualCollisionProtection ? state.manualReplyUntil : null, expiresAt: input.jobExpiresAt, lastCustomerMessageAt: state.lastCustomerMessageAt });
  const live = await prisma.configurationVersion.findFirst({ where: { pageId: input.pageId, status: "LIVE" }, select: { version: true } });
  const configInvalid = !live || state.page.lifecycleStatus !== "LIVE" || (input.generatedConfigurationVersion !== undefined && live.version !== input.generatedConfigurationVersion);
  const payload = { recipient: input.recipientPsid, text: input.text };
  const blockedReason = !state.page.isActive ? "Page inactive" : !state.page.aiEnabled ? "AI paused" : state.page.aiStatus === "PAUSED_BY_BUDGET" ? "Blocked by Page budget" : state.page.connectionStatus !== "CONNECTED" ? "Meta connection unavailable" : configInvalid ? "Configuration changed or is not LIVE" : !check.ok ? check.reason : null;
  let outbound;
  try {
    outbound = await prisma.outboundMessage.create({ data: { pageId: input.pageId, conversationId: input.conversationId, outboundAttemptKey: input.outboundAttemptKey, payload, status: paused || !check.ok || configInvalid ? "FAILED_PERMANENT" : "PENDING", lastError: blockedReason } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return prisma.outboundMessage.findUniqueOrThrow({ where: { outboundAttemptKey: input.outboundAttemptKey } });
    throw error;
  }
  if (paused || !check.ok || configInvalid) return outbound;
  if (!state.page.connection?.encryptedToken) return prisma.outboundMessage.update({ where: { id: outbound.id }, data: { status: "FAILED_PERMANENT", lastError: "Meta connection credential missing" } });
  await prisma.outboundMessage.update({ where: { id: outbound.id }, data: { status: "SENDING" } });
  try {
    const result = await sendMetaMessage(decryptCredential(state.page.connection.encryptedToken), input.recipientPsid, input.text);
    return prisma.outboundMessage.update({ where: { id: outbound.id }, data: { status: "SENT", providerMessageId: result.message_id, sentAt: new Date() } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Meta send failed";
    const transient = classifyFailure(error) === "TRANSIENT";
    const unknownDelivery = transient && /timeout|abort|timed out/i.test(message);
    await upsertActionableIssue({ pageId: input.pageId, type: "META_DELIVERY", title: unknownDelivery ? "Messenger delivery outcome is unknown" : "Messenger delivery requires attention", description: message.slice(0, 500), severity: "high", resolutionAction: unknownDelivery ? "Check Meta delivery logs before retrying to avoid a duplicate customer reply." : "Reconnect the Page or correct the recipient/provider permission." });
    const next = await prisma.outboundMessage.update({ where: { id: outbound.id }, data: { status: unknownDelivery ? "UNKNOWN_DELIVERY" : transient ? "FAILED_RETRYABLE" : "FAILED_PERMANENT", lastError: message.slice(0, 500) } });
    if (transient && !unknownDelivery) await prisma.job.create({ data: { pageId: input.pageId, conversationId: input.conversationId, type: "RETRY_OUTBOUND", payload: { outboundMessageId: outbound.id }, runAt: new Date(Date.now() + backoffWithJitter(1)), idempotencyKey: `outbound-retry:${outbound.id}` } }).catch(() => undefined);
    return next;
  }
}

export async function processOutboundRetry(outboundMessageId: string) {
  const current = await prisma.outboundMessage.findFirst({ where: { id: outboundMessageId, status: "FAILED_RETRYABLE" }, include: { page: { include: { connection: true } } } });
  if (!current) return;
  if (!current.page.connection?.encryptedToken) throw new Error("Meta connection credential missing for outbound retry");
  const claimed = await prisma.outboundMessage.updateMany({ where: { id: current.id, status: "FAILED_RETRYABLE" }, data: { status: "SENDING" } });
  if (claimed.count !== 1) return;
  const payload = current.payload as { recipient?: string; text?: string };
  try {
    const result = await sendMetaMessage(decryptCredential(current.page.connection.encryptedToken), String(payload.recipient ?? ""), String(payload.text ?? ""));
    await prisma.outboundMessage.update({ where: { id: current.id }, data: { status: "SENT", providerMessageId: result.message_id, sentAt: new Date(), lastError: null } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Meta send failed";
    const transient = classifyFailure(error) === "TRANSIENT";
    const unknownDelivery = transient && /timeout|abort|timed out/i.test(message);
    await prisma.outboundMessage.update({ where: { id: current.id }, data: { status: unknownDelivery ? "UNKNOWN_DELIVERY" : transient ? "FAILED_RETRYABLE" : "FAILED_PERMANENT", lastError: message.slice(0, 500) } });
    if (transient && !unknownDelivery) throw error;
  }
}
