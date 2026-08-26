import { prisma } from "@/lib/db/prisma";
import { redactSensitiveText } from "@/lib/logging/logger";
import { sendFacebookMessage } from "@/services/meta/connection";
import { checkMessengerRuntime } from "@/services/meta/runtime-gate";
import { canSendReply } from "@/services/messaging/version";
import { classifyFailure } from "@/services/resilience/retry";
import { upsertActionableIssue } from "@/services/issues/service";
import { Prisma } from "@prisma/client";
import { backoffWithJitter } from "@/services/resilience/retry";
import { validateAndCorrectCommercialReply } from "@/services/messaging/commercial-guard";

type CommercialOrderState = Parameters<typeof validateAndCorrectCommercialReply>[0]["currentOrderState"];
type StoredOutboundPayload = {
  recipient?: string;
  text?: string;
  recommendedProductIds?: string[];
  generatedConfigurationVersion?: number;
  currentOrderState?: CommercialOrderState;
  commercialGuard?: string;
  commercialGuardReason?: string | null;
  generatedVersion?: number;
  jobExpiresAt?: string | null;
};

function retryExpiry(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

export async function sendSafeReply(input: { pageId: string; conversationId: string; recipientPsid: string; text: string; generatedVersion: number; recommendedProductIds?: string[]; generatedConfigurationVersion?: number; currentOrderState?: { reference?: string | null; status?: string | null; productName?: string | null; variantDetails?: { sku?: string | null; size?: string | null; color?: string | null } | null; unitPrice?: number | null; total?: number | null; quantity?: number | null; currency?: string | null } | null; jobExpiresAt?: Date | null; outboundAttemptKey: string }) {
  const existing = await prisma.outboundMessage.findUnique({ where: { outboundAttemptKey: input.outboundAttemptKey } });
  if (existing) {
    if (existing.pageId !== input.pageId || existing.conversationId !== input.conversationId) throw new Error("Outbound attempt key exists outside page scope");
    return existing;
  }
  const state = await prisma.conversation.findFirst({ where: { id: input.conversationId, pageId: input.pageId }, include: { customer: true, page: { include: { connection: true, settings: true, aiSettings: true } } } });
  if (!state?.customer || state.customer.pageId !== input.pageId) throw new Error("Conversation customer not found in page scope");
  const recipientPsid = state.customer.facebookPsid;
  if (input.recipientPsid !== recipientPsid || (state.providerId && state.providerId !== recipientPsid)) throw new Error("Messenger recipient does not match the page-scoped conversation");
  const runtime = checkMessengerRuntime(state.page);
  const check = canSendReply({ generatedVersion: input.generatedVersion, currentVersion: state.version, manualReplyUntil: state.page.aiSettings?.manualCollisionProtection ? state.manualReplyUntil : null, expiresAt: input.jobExpiresAt, lastCustomerMessageAt: state.lastCustomerMessageAt });
  const live = await prisma.configurationVersion.findFirst({ where: { pageId: input.pageId, status: "LIVE" }, select: { version: true } });
  const configurationUnavailable = !live || state.page.lifecycleStatus !== "LIVE";
  const guard = configurationUnavailable ? { status: "BLOCKED" as const, reply: "I’m sorry, the current Page information is not available right now.", reason: "Configuration is not LIVE" } : await validateAndCorrectCommercialReply({ pageId: input.pageId, generatedReply: input.text, recommendedProductIds: input.recommendedProductIds, generatedConfigurationVersion: input.generatedConfigurationVersion, currentOrderState: input.currentOrderState });
  const safeText = guard.status === "CORRECTED" ? guard.reply : guard.status === "SAFE_TO_SEND" ? input.text : guard.reply || "I’m sorry, I can’t confirm that information from the current Page configuration right now.";
  const payload: StoredOutboundPayload = { recipient: recipientPsid, text: safeText, recommendedProductIds: input.recommendedProductIds ?? [], generatedConfigurationVersion: input.generatedConfigurationVersion, currentOrderState: input.currentOrderState, commercialGuard: guard.status, commercialGuardReason: guard.reason ?? null, generatedVersion: input.generatedVersion, jobExpiresAt: input.jobExpiresAt?.toISOString() ?? null };
  const blockedReason = !runtime.ok ? `Messenger runtime blocked: ${runtime.reason}` : configurationUnavailable ? "Configuration changed or is not LIVE" : !check.ok ? check.reason : guard.status === "SAFE_TO_SEND" || guard.status === "CORRECTED" ? null : guard.reason ?? "Commercial reply failed validation";
  const blocked = !runtime.ok || !check.ok || configurationUnavailable;
  let outbound;
  try {
    outbound = await prisma.outboundMessage.create({ data: { pageId: input.pageId, conversationId: input.conversationId, outboundAttemptKey: input.outboundAttemptKey, payload: payload as Prisma.InputJsonValue, status: blocked ? "FAILED_PERMANENT" : "PENDING", lastError: blocked ? blockedReason : null } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return prisma.outboundMessage.findUniqueOrThrow({ where: { outboundAttemptKey: input.outboundAttemptKey } });
    throw error;
  }
  if (blocked) return outbound;
  await prisma.outboundMessage.update({ where: { id: outbound.id }, data: { status: "SENDING" } });
  try {
    const finalGuard = await validateAndCorrectCommercialReply({ pageId: input.pageId, generatedReply: safeText, recommendedProductIds: guard.status === "SAFE_TO_SEND" || guard.status === "CORRECTED" ? input.recommendedProductIds : [], generatedConfigurationVersion: guard.status === "SAFE_TO_SEND" || guard.status === "CORRECTED" ? input.generatedConfigurationVersion : undefined, currentOrderState: guard.status === "SAFE_TO_SEND" || guard.status === "CORRECTED" ? input.currentOrderState : null });
    if (!["SAFE_TO_SEND", "CORRECTED"].includes(finalGuard.status)) return prisma.outboundMessage.update({ where: { id: outbound.id }, data: { status: "FAILED_PERMANENT", lastError: finalGuard.reason ?? "Commercial reply changed before send" } });
    const finalText = finalGuard.status === "CORRECTED" ? finalGuard.reply : safeText;
    if (finalText !== safeText) await prisma.outboundMessage.update({ where: { id: outbound.id }, data: { payload: { ...payload, text: finalText } } });
    const result = await sendFacebookMessage({ pageId: input.pageId, recipientId: recipientPsid, text: finalText });
    return prisma.outboundMessage.update({ where: { id: outbound.id }, data: { status: "SENT", providerMessageId: result.message_id, sentAt: new Date() } });
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : "Meta send failed";
    const message = redactSensitiveText(rawMessage).slice(0, 500);
    const transient = classifyFailure(error) === "TRANSIENT";
    const unknownDelivery = transient && /timeout|abort|timed out/i.test(rawMessage);
    await upsertActionableIssue({ pageId: input.pageId, type: "FACEBOOK_DELIVERY_ERROR", title: unknownDelivery ? "Messenger delivery outcome is unknown" : "Messenger delivery requires attention", description: message, severity: "high", resolutionAction: unknownDelivery ? "Check Meta delivery logs before retrying to avoid a duplicate customer reply." : "Reconnect the Page or correct the recipient/provider permission." });
    const next = await prisma.outboundMessage.update({ where: { id: outbound.id }, data: { status: unknownDelivery ? "UNKNOWN_DELIVERY" : transient ? "FAILED_RETRYABLE" : "FAILED_PERMANENT", lastError: message } });
    if (transient && !unknownDelivery) await prisma.job.create({ data: { pageId: input.pageId, conversationId: input.conversationId, type: "RETRY_OUTBOUND", payload: { outboundMessageId: outbound.id }, runAt: new Date(Date.now() + backoffWithJitter(1)), idempotencyKey: `outbound-retry:${outbound.id}` } }).catch(() => undefined);
    return next;
  }
}

export async function processOutboundRetry(pageId: string, outboundMessageId: string) {
  const current = await prisma.outboundMessage.findFirst({ where: { id: outboundMessageId, pageId, status: "FAILED_RETRYABLE" }, include: { page: { include: { connection: true, aiSettings: true } }, conversation: { include: { customer: true } } } });
  if (!current) return;
  const payload = current.payload as StoredOutboundPayload;
  const recipientPsid = current.conversation?.customer?.facebookPsid;
  const runtime = checkMessengerRuntime(current.page);
  const scopeValid = Boolean(current.conversation && current.conversation.pageId === pageId && current.conversation.customer?.pageId === pageId && recipientPsid && payload.recipient === recipientPsid && (!current.conversation.providerId || current.conversation.providerId === recipientPsid));
  const generatedVersion = typeof payload.generatedVersion === "number" ? payload.generatedVersion : Number.NaN;
  const check = current.conversation && Number.isFinite(generatedVersion) ? canSendReply({ generatedVersion, currentVersion: current.conversation.version, manualReplyUntil: current.page.aiSettings?.manualCollisionProtection ? current.conversation.manualReplyUntil : null, expiresAt: retryExpiry(payload.jobExpiresAt), lastCustomerMessageAt: current.conversation.lastCustomerMessageAt }) : { ok: false as const, reason: "RETRY_METADATA_MISSING" as const };
  if (!runtime.ok || !scopeValid || !check.ok) {
    const reason = !runtime.ok ? `Messenger runtime blocked: ${runtime.reason}` : !scopeValid ? "Messenger retry recipient is outside page scope" : check.reason;
    await prisma.outboundMessage.update({ where: { id: current.id }, data: { status: "FAILED_PERMANENT", lastError: reason } });
    return;
  }
  const claimed = await prisma.outboundMessage.updateMany({ where: { id: current.id, status: "FAILED_RETRYABLE" }, data: { status: "SENDING" } });
  if (claimed.count !== 1) return;
  try {
    const guard = await validateAndCorrectCommercialReply({ pageId: current.pageId, generatedReply: String(payload.text ?? ""), recommendedProductIds: payload.recommendedProductIds, generatedConfigurationVersion: payload.generatedConfigurationVersion, currentOrderState: payload.currentOrderState });
    const safeText = guard.status === "CORRECTED" ? guard.reply : guard.status === "SAFE_TO_SEND" ? String(payload.text ?? "") : guard.reply || "I’m sorry, I can’t confirm that information from the current Page configuration right now.";
    const finalGuard = await validateAndCorrectCommercialReply({ pageId: current.pageId, generatedReply: safeText, recommendedProductIds: guard.status === "SAFE_TO_SEND" || guard.status === "CORRECTED" ? payload.recommendedProductIds : [], generatedConfigurationVersion: guard.status === "SAFE_TO_SEND" || guard.status === "CORRECTED" ? payload.generatedConfigurationVersion : undefined, currentOrderState: guard.status === "SAFE_TO_SEND" || guard.status === "CORRECTED" ? payload.currentOrderState : null });
    if (!["SAFE_TO_SEND", "CORRECTED"].includes(finalGuard.status)) {
      await prisma.outboundMessage.update({ where: { id: current.id }, data: { status: "FAILED_PERMANENT", lastError: finalGuard.reason ?? "Commercial reply changed before retry" } });
      return;
    }
    const result = await sendFacebookMessage({ pageId, recipientId: recipientPsid!, text: finalGuard.status === "CORRECTED" ? finalGuard.reply : safeText });
    await prisma.outboundMessage.update({ where: { id: current.id }, data: { status: "SENT", payload: { ...payload, text: finalGuard.status === "CORRECTED" ? finalGuard.reply : safeText }, providerMessageId: result.message_id, sentAt: new Date(), lastError: null } });
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : "Meta send failed";
    const message = redactSensitiveText(rawMessage).slice(0, 500);
    const transient = classifyFailure(error) === "TRANSIENT";
    const unknownDelivery = transient && /timeout|abort|timed out/i.test(rawMessage);
    await upsertActionableIssue({ pageId, type: "FACEBOOK_DELIVERY_ERROR", title: unknownDelivery ? "Messenger delivery outcome is unknown" : "Messenger delivery requires attention", description: message, severity: "high", resolutionAction: unknownDelivery ? "Check Meta delivery logs before retrying to avoid a duplicate customer reply." : "Reconnect the Page or correct the recipient/provider permission." });
    await prisma.outboundMessage.update({ where: { id: current.id }, data: { status: unknownDelivery ? "UNKNOWN_DELIVERY" : transient ? "FAILED_RETRYABLE" : "FAILED_PERMANENT", lastError: message } });
    if (transient && !unknownDelivery) throw error;
  }
}
