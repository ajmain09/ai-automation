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
  if (job.type === "RETRY_OUTBOUND") await processOutboundRetry(String((job.payload as { outboundMessageId?: string }).outboundMessageId));
  if (job.type === "PROCESS_TELEGRAM_DELIVERY") await processNextTelegramDelivery();
}, { signal: controller.signal }).catch((error) => { logger.error({ error: error instanceof Error ? error.message : "worker failure" }, "worker.stopped"); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); logger.info("worker.shutdown.complete"); });
