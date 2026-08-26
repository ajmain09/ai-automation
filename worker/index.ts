import { logger } from "@/lib/logging/logger";
import { PostgresJobQueue, runWorker } from "@/services/jobs/queue";
import { processConversationJob } from "@/services/ai/conversation";
import { processOutboundRetry } from "@/services/messaging/outbound";
import { processNextTelegramDelivery } from "@/services/telegram/outbox";
import { prisma } from "@/lib/db/prisma";

const queue = new PostgresJobQueue();
const controller = new AbortController();
const workerId = `worker-${process.pid}-${Date.now()}`;
const heartbeat = async () => { await prisma.workerHeartbeat.upsert({ where: { workerId }, update: { lastHeartbeatAt: new Date() }, create: { workerId, startedAt: new Date(), lastHeartbeatAt: new Date() } }); };
void heartbeat();
const heartbeatTimer = setInterval(() => { void heartbeat(); }, 20_000);
process.on("SIGTERM", () => controller.abort());
process.on("SIGINT", () => controller.abort());
logger.info("worker.ready");
void runWorker(queue, async (job) => {
  switch (job.type) {
    case "PROCESS_CONVERSATION":
      await processConversationJob(job);
      break;
    case "RETRY_OUTBOUND": {
      const outboundMessageId = (job.payload as { outboundMessageId?: unknown }).outboundMessageId;
      if (!job.pageId || typeof outboundMessageId !== "string") throw new Error("Invalid page-scoped outbound retry payload");
      await processOutboundRetry(job.pageId, outboundMessageId);
      break;
    }
    case "PROCESS_TELEGRAM_DELIVERY":
      await processNextTelegramDelivery();
      break;
    default:
      throw new Error(`Unknown job type: ${job.type}`);
  }
}, { signal: controller.signal }).catch((error) => { logger.error({ error: error instanceof Error ? error.message : "worker failure" }, "worker.stopped"); process.exitCode = 1; }).finally(async () => { clearInterval(heartbeatTimer); await prisma.$disconnect(); logger.info("worker.shutdown.complete"); });
