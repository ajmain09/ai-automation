import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { enqueuePostgresJobTx, JobQueue, PostgresJobQueue } from "@/services/jobs/queue";
import { getMetaPlatformConfig } from "@/services/meta/settings";

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
  const body = z.object({ object: z.string().optional(), entry: z.array(z.object({ id: z.string(), messaging: z.array(eventSchema).optional() }).passthrough()) }).safeParse(payload);
  if (!body.success) throw new Error("Invalid Meta webhook payload");
  const metaConfig = await getMetaPlatformConfig();
  for (const entry of body.data.entry) {
    const page = await prisma.page.findUnique({ where: { metaPageId: entry.id }, select: { id: true, metaPageId: true, aiEnabled: true, aiStatus: true, isActive: true, aiSettings: { select: { smartBuffer: true, bufferWindowSeconds: true, manualCollisionProtection: true, manualActivityCooldown: true } } } });
    if (!page) continue;
    for (const event of entry.messaging ?? []) {
      const message = event.message;
      const providerId = `${entry.id}:${message?.mid ?? crypto.createHash("sha256").update(JSON.stringify(event)).digest("hex")}`;
      const isSystemEvent = Boolean(event.delivery || event.read || (!message?.text && !message?.attachments?.length));
      const isSystemEcho = Boolean(message?.is_echo && (!metaConfig.appId || message.app_id === metaConfig.appId));
      const isManualEcho = Boolean(message?.is_echo && !isSystemEcho);
      const ignoredReason = isSystemEvent ? "unsupported_or_system_event" : isSystemEcho ? "software_echo" : undefined;
      try {
        await prisma.$transaction(async (tx) => {
          await tx.webhookEvent.create({ data: { pageId: page.id, providerId, payload: JSON.parse(rawBody) as import("@prisma/client").Prisma.InputJsonValue, eventType: isManualEcho ? "manual_page_reply" : "message", ignoredReason, signatureValid, processedAt: ignoredReason ? new Date() : null } });
          if (ignoredReason) return;
          const customer = await tx.customer.upsert({ where: { pageId_facebookPsid: { pageId: page.id, facebookPsid: event.sender.id } }, update: {}, create: { pageId: page.id, facebookPsid: event.sender.id } });
          const conversation = await tx.conversation.upsert({ where: { pageId_providerId: { pageId: page.id, providerId: event.sender.id } }, update: {}, create: { pageId: page.id, providerId: event.sender.id, customerId: customer.id } });
          if (isManualEcho) {
            if (page.aiSettings?.manualCollisionProtection) await tx.conversation.update({ where: { id: conversation.id }, data: { manualReplyUntil: new Date(Date.now() + page.aiSettings.manualActivityCooldown * 1000), lastManualReplyAt: new Date() } });
            await tx.webhookEvent.update({ where: { providerId }, data: { processedAt: new Date() } });
            return;
          }
          const updated = await tx.conversation.update({ where: { id: conversation.id }, data: { customerId: customer.id, version: { increment: 1 }, lastCustomerMessageAt: new Date() } });
          await tx.message.create({ data: { pageId: page.id, conversationId: conversation.id, providerId, direction: "INBOUND", text: message?.text ?? null, senderPsid: event.sender.id, metadata: event as unknown as import("@prisma/client").Prisma.InputJsonValue } });
          if (page.isActive && page.aiEnabled && page.aiStatus !== "PAUSED_BY_BUDGET") {
            const delayMs = page.aiSettings?.smartBuffer ? page.aiSettings.bufferWindowSeconds * 1000 : 0;
            const job = queue instanceof PostgresJobQueue ? await enqueuePostgresJobTx(tx, { pageId: page.id, conversationId: conversation.id, type: "PROCESS_CONVERSATION", payload: { conversationId: conversation.id, version: updated.version }, delayMs, ttlMs: 5 * 60_000, idempotencyKey: `reply:${page.id}:${providerId}` }) : await queue.enqueue({ pageId: page.id, conversationId: conversation.id, type: "PROCESS_CONVERSATION", payload: { conversationId: conversation.id, version: updated.version }, delayMs, ttlMs: 5 * 60_000, idempotencyKey: `reply:${page.id}:${providerId}` });
            await tx.webhookEvent.update({ where: { providerId }, data: { processedAt: new Date() } });
            void job;
          }
        });
      } catch (error) {
        if (error instanceof Error && /unique/i.test(error.message)) return { accepted: true, duplicate: true };
        throw error;
      }
    }
  }
  return { accepted: true };
}
