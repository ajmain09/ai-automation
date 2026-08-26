import crypto from "node:crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { enqueuePostgresJobTx, JobQueue, PostgresJobQueue } from "@/services/jobs/queue";
import { getMetaPlatformConfig } from "@/services/meta/settings";
import { checkMessengerRuntime } from "@/services/meta/runtime-gate";

const messageSchema = z.object({
  mid: z.string().optional(),
  text: z.string().optional(),
  is_echo: z.boolean().optional(),
  app_id: z.string().optional(),
  attachments: z.array(z.unknown()).optional(),
}).passthrough();
const eventSchema = z.object({
  sender: z.object({ id: z.string().min(1) }),
  recipient: z.object({ id: z.string().min(1) }),
  timestamp: z.number().optional(),
  message: messageSchema.optional(),
  delivery: z.unknown().optional(),
  read: z.unknown().optional(),
}).passthrough();

export type WebhookResult = { accepted: boolean; duplicate?: boolean; ignored?: string; jobId?: string };

export async function webhookSignatureRequired() { return Boolean((await getMetaPlatformConfig()).appSecret); }

export async function ingestMetaWebhook(rawBody: string, payload: unknown, queue: JobQueue, signatureValid = false): Promise<WebhookResult> {
  void rawBody;
  const body = z.object({ object: z.literal("page"), entry: z.array(z.object({ id: z.string().min(1), messaging: z.array(eventSchema).optional() }).passthrough()) }).safeParse(payload);
  if (!body.success) throw new Error("Invalid Meta webhook payload");
  const metaConfig = await getMetaPlatformConfig();
  let duplicate = false;
  for (const entry of body.data.entry) {
    const page = await prisma.page.findUnique({ where: { metaPageId: entry.id }, select: { id: true } });
    if (!page) continue;
    for (const event of entry.messaging ?? []) {
      const message = event.message;
      const providerId = `${entry.id}:${message?.mid ?? crypto.createHash("sha256").update(JSON.stringify(event)).digest("hex")}`;
      const isSystemEvent = Boolean(event.delivery || event.read || (!message?.text && !message?.attachments?.length));
      const isSystemEcho = Boolean(message?.is_echo && (!metaConfig.appId || message.app_id === metaConfig.appId));
      const isManualEcho = Boolean(message?.is_echo && !isSystemEcho);
      const identityMatches = message?.is_echo ? event.sender.id === entry.id : event.recipient.id === entry.id;
      const ignoredReason = isSystemEvent ? "unsupported_or_system_event" : !identityMatches ? "page_identity_mismatch" : isSystemEcho ? "software_echo" : undefined;
      try {
        await prisma.$transaction(async (tx) => {
          const currentPage = await tx.page.findUnique({ where: { id: page.id }, select: { id: true, metaPageId: true, aiEnabled: true, aiStatus: true, isActive: true, lifecycleStatus: true, connectionStatus: true, connection: { select: { status: true, encryptedToken: true } }, aiSettings: { select: { smartBuffer: true, bufferWindowSeconds: true, manualCollisionProtection: true, manualActivityCooldown: true } } } });
          if (!currentPage) return;
          const eventPayload = { object: "page", entry: [{ id: entry.id, messaging: [event] }] } as Prisma.InputJsonValue;
          await tx.webhookEvent.create({ data: { pageId: currentPage.id, providerId, payload: eventPayload, eventType: isManualEcho ? "manual_page_reply" : "message", ignoredReason, signatureValid, processedAt: ignoredReason ? new Date() : null } });
          if (ignoredReason) return;
          const customerPsid = isManualEcho ? event.recipient.id : event.sender.id;
          const customer = await tx.customer.upsert({ where: { pageId_facebookPsid: { pageId: currentPage.id, facebookPsid: customerPsid } }, update: {}, create: { pageId: currentPage.id, facebookPsid: customerPsid } });
          const conversation = await tx.conversation.upsert({ where: { pageId_providerId: { pageId: currentPage.id, providerId: customerPsid } }, update: { customerId: customer.id }, create: { pageId: currentPage.id, providerId: customerPsid, customerId: customer.id } });
          if (isManualEcho) {
            if (currentPage.aiSettings?.manualCollisionProtection) await tx.conversation.update({ where: { id: conversation.id }, data: { manualReplyUntil: new Date(Date.now() + currentPage.aiSettings.manualActivityCooldown * 1000), lastManualReplyAt: new Date() } });
            await tx.webhookEvent.update({ where: { providerId }, data: { processedAt: new Date() } });
            return;
          }
          const updated = await tx.conversation.update({ where: { id: conversation.id }, data: { customerId: customer.id, version: { increment: 1 }, lastCustomerMessageAt: new Date() } });
          await tx.message.create({ data: { pageId: currentPage.id, conversationId: conversation.id, providerId, direction: "INBOUND", text: message?.text ?? null, senderPsid: customerPsid, metadata: event as unknown as Prisma.InputJsonValue } });
          const runtime = checkMessengerRuntime(currentPage);
          if (!runtime.ok) {
            await tx.webhookEvent.update({ where: { providerId }, data: { processedAt: new Date(), ignoredReason: `runtime_gate_${runtime.reason}` } });
            return;
          }
          const delayMs = currentPage.aiSettings?.smartBuffer ? currentPage.aiSettings.bufferWindowSeconds * 1000 : 0;
          const jobInput = { pageId: currentPage.id, conversationId: conversation.id, type: "PROCESS_CONVERSATION", payload: { conversationId: conversation.id, version: updated.version }, delayMs, ttlMs: 5 * 60_000, idempotencyKey: `reply:${currentPage.id}:${providerId}` };
          const job = queue instanceof PostgresJobQueue ? await enqueuePostgresJobTx(tx, jobInput) : await queue.enqueue(jobInput);
          await tx.webhookEvent.update({ where: { providerId }, data: { processedAt: new Date() } });
          void job;
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          duplicate = true;
          continue;
        }
        throw error;
      }
    }
  }
  return { accepted: true, ...(duplicate ? { duplicate: true } : {}) };
}
