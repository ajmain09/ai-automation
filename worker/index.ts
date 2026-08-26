import { logger } from "@/lib/logging/logger";
import { PostgresJobQueue, runWorker } from "@/services/jobs/queue";
import { processConversationJob } from "@/services/ai/conversation";
import { processOutboundRetry } from "@/services/messaging/outbound";
import { processNextTelegramDelivery } from "@/services/telegram/outbox";
import { prisma } from "@/lib/db/prisma";

const queue = new PostgresJobQueue();
const controller = new AbortController();
process.on("SIGTERM", () => controller.abort());
process.on("SIGINT", () => controller.abort());
logger.info("worker.ready");
void runWorker(queue, async (job) => {
  if (job.type === "PROCESS_CONVERSATION") await processConversationJob(job);
  if (job.type === "RETRY_OUTBOUND") {
    const outboundMessageId = (job.payload as { outboundMessageId?: unknown }).outboundMessageId;
    if (!job.pageId || typeof outboundMessageId !== "string") throw new Error("Invalid page-scoped outbound retry payload");
    await processOutboundRetry(job.pageId, outboundMessageId);
  }
  if (job.type === "PROCESS_TELEGRAM_DELIVERY") await processNextTelegramDelivery();
  else if (job.type !== "PROCESS_CONVERSATION" && job.type !== "RETRY_OUTBOUND") throw new Error(`Unknown job type: ${job.type}`);
}, { signal: controller.signal }).catch((error) => { logger.error({ error: error instanceof Error ? error.message : "worker failure" }, "worker.stopped"); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); logger.info("worker.shutdown.complete"); });
