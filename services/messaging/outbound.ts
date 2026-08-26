import { prisma } from "@/lib/db/prisma";
import { decryptCredential } from "@/lib/encryption/service";
import { sendMetaMessage } from "@/services/meta/service";
import { canSendReply } from "@/services/messaging/version";
import { classifyFailure } from "@/services/resilience/retry";
import { upsertActionableIssue } from "@/services/issues/service";
import { Prisma } from "@prisma/client";
import { backoffWithJitter } from "@/services/resilience/retry";
import { validateAndCorrectCommercialReply } from "@/services/messaging/commercial-guard";

export async function sendSafeReply(input: { pageId: string; conversationId: string; recipientPsid: string; text: string; generatedVersion: number; recommendedProductIds?: string[]; generatedConfigurationVersion?: number; currentOrderState?: { reference?: string | null; status?: string | null; productName?: string | null; variantDetails?: { sku?: string | null; size?: string | null; color?: string | null } | null; unitPrice?: number | null; total?: number | null; quantity?: number | null; currency?: string | null } | null; jobExpiresAt?: Date | null; outboundAttemptKey: string }) {
  const existing = await prisma.outboundMessage.findUnique({ where: { outboundAttemptKey: input.outboundAttemptKey } });
  if (existing) return existing;
  const state = await prisma.conversation.findFirst({ where: { id: input.conversationId, pageId: input.pageId }, include: { page: { include: { connection: true, settings: true, aiSettings: true } } } });
  if (!state) throw new Error("Conversation not found in page scope");
  const paused = !state.page.isActive || !state.page.aiEnabled || state.page.aiStatus === "PAUSED_BY_BUDGET" || state.page.connectionStatus !== "CONNECTED";
  const check = canSendReply({ generatedVersion: input.generatedVersion, currentVersion: state.version, manualReplyUntil: state.page.aiSettings?.manualCollisionProtection ? state.manualReplyUntil : null, expiresAt: input.jobExpiresAt, lastCustomerMessageAt: state.lastCustomerMessageAt });
  const live = await prisma.configurationVersion.findFirst({ where: { pageId: input.pageId, status: "LIVE" }, select: { version: true } });
  const configurationUnavailable = !live || state.page.lifecycleStatus !== "LIVE";
  const guard = configurationUnavailable ? { status: "BLOCKED" as const, reply: "I’m sorry, the current Page information is not available right now.", reason: "Configuration is not LIVE" } : await validateAndCorrectCommercialReply({ pageId: input.pageId, generatedReply: input.text, recommendedProductIds: input.recommendedProductIds, generatedConfigurationVersion: input.generatedConfigurationVersion, currentOrderState: input.currentOrderState });
  const safeText = guard.status === "CORRECTED" ? guard.reply : guard.status === "SAFE_TO_SEND" ? input.text : guard.reply || "I’m sorry, I can’t confirm that information from the current Page configuration right now.";
  const payload = { recipient: input.recipientPsid, text: safeText, recommendedProductIds: input.recommendedProductIds ?? [], generatedConfigurationVersion: input.generatedConfigurationVersion, currentOrderState: input.currentOrderState, commercialGuard: guard.status, commercialGuardReason: guard.reason ?? null };
  const blockedReason = !state.page.isActive ? "Page inactive" : !state.page.aiEnabled ? "AI paused" : state.page.aiStatus === "PAUSED_BY_BUDGET" ? "Blocked by Page budget" : state.page.connectionStatus !== "CONNECTED" ? "Meta connection unavailable" : configurationUnavailable ? "Configuration changed or is not LIVE" : !check.ok ? check.reason : guard.status === "SAFE_TO_SEND" || guard.status === "CORRECTED" ? null : guard.reason ?? "Commercial reply failed validation";
  let outbound;
  try {
    outbound = await prisma.outboundMessage.create({ data: { pageId: input.pageId, conversationId: input.conversationId, outboundAttemptKey: input.outboundAttemptKey, payload, status: paused || !check.ok || configurationUnavailable ? "FAILED_PERMANENT" : "PENDING", lastError: paused || !check.ok || configurationUnavailable ? blockedReason : null } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return prisma.outboundMessage.findUniqueOrThrow({ where: { outboundAttemptKey: input.outboundAttemptKey } });
    throw error;
  }
  if (paused || !check.ok || configurationUnavailable) return outbound;
  if (!state.page.connection?.encryptedToken) return prisma.outboundMessage.update({ where: { id: outbound.id }, data: { status: "FAILED_PERMANENT", lastError: "Meta connection credential missing" } });
  await prisma.outboundMessage.update({ where: { id: outbound.id }, data: { status: "SENDING" } });
  try {
    const finalGuard = await validateAndCorrectCommercialReply({ pageId: input.pageId, generatedReply: safeText, recommendedProductIds: guard.status === "SAFE_TO_SEND" || guard.status === "CORRECTED" ? input.recommendedProductIds : [], generatedConfigurationVersion: guard.status === "SAFE_TO_SEND" || guard.status === "CORRECTED" ? input.generatedConfigurationVersion : undefined, currentOrderState: guard.status === "SAFE_TO_SEND" || guard.status === "CORRECTED" ? input.currentOrderState : null });
    if (!["SAFE_TO_SEND", "CORRECTED"].includes(finalGuard.status)) return prisma.outboundMessage.update({ where: { id: outbound.id }, data: { status: "FAILED_PERMANENT", lastError: finalGuard.reason ?? "Commercial reply changed before send" } });
    const finalText = finalGuard.status === "CORRECTED" ? finalGuard.reply : safeText;
    if (finalText !== safeText) await prisma.outboundMessage.update({ where: { id: outbound.id }, data: { payload: { ...payload, text: finalText } } });
    const result = await sendMetaMessage(decryptCredential(state.page.connection.encryptedToken), input.recipientPsid, finalText);
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
  const current = await prisma.outboundMessage.findFirst({ where: { id: outboundMessageId, status: "FAILED_RETRYABLE" }, include: { page: { include: { connection: true } }, conversation: true } });
  if (!current) return;
  if (!current.page.connection?.encryptedToken) throw new Error("Meta connection credential missing for outbound retry");
  const claimed = await prisma.outboundMessage.updateMany({ where: { id: current.id, status: "FAILED_RETRYABLE" }, data: { status: "SENDING" } });
  if (claimed.count !== 1) return;
  const payload = current.payload as { recipient?: string; text?: string; recommendedProductIds?: string[]; generatedConfigurationVersion?: number; currentOrderState?: Parameters<typeof validateAndCorrectCommercialReply>[0]["currentOrderState"] };
  const guard = await validateAndCorrectCommercialReply({ pageId: current.pageId, generatedReply: String(payload.text ?? ""), recommendedProductIds: payload.recommendedProductIds, generatedConfigurationVersion: payload.generatedConfigurationVersion, currentOrderState: payload.currentOrderState });
  const safeText = guard.status === "CORRECTED" ? guard.reply : guard.status === "SAFE_TO_SEND" ? String(payload.text ?? "") : guard.reply || "I’m sorry, I can’t confirm that information from the current Page configuration right now.";
  try {
    const finalGuard = await validateAndCorrectCommercialReply({ pageId: current.pageId, generatedReply: safeText, recommendedProductIds: guard.status === "SAFE_TO_SEND" || guard.status === "CORRECTED" ? payload.recommendedProductIds : [], generatedConfigurationVersion: guard.status === "SAFE_TO_SEND" || guard.status === "CORRECTED" ? payload.generatedConfigurationVersion : undefined, currentOrderState: guard.status === "SAFE_TO_SEND" || guard.status === "CORRECTED" ? payload.currentOrderState : null });
    if (!["SAFE_TO_SEND", "CORRECTED"].includes(finalGuard.status)) {
      await prisma.outboundMessage.update({ where: { id: current.id }, data: { status: "FAILED_PERMANENT", lastError: finalGuard.reason ?? "Commercial reply changed before retry" } });
      return;
    }
    const result = await sendMetaMessage(decryptCredential(current.page.connection.encryptedToken), String(payload.recipient ?? ""), finalGuard.status === "CORRECTED" ? finalGuard.reply : safeText);
    await prisma.outboundMessage.update({ where: { id: current.id }, data: { status: "SENT", payload: { ...payload, text: finalGuard.status === "CORRECTED" ? finalGuard.reply : safeText }, providerMessageId: result.message_id, sentAt: new Date(), lastError: null } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Meta send failed";
    const transient = classifyFailure(error) === "TRANSIENT";
    const unknownDelivery = transient && /timeout|abort|timed out/i.test(message);
    await prisma.outboundMessage.update({ where: { id: current.id }, data: { status: unknownDelivery ? "UNKNOWN_DELIVERY" : transient ? "FAILED_RETRYABLE" : "FAILED_PERMANENT", lastError: message.slice(0, 500) } });
    if (transient && !unknownDelivery) throw error;
  }
}
