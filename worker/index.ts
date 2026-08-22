import { logger } from "@/lib/logging/logger";
import { PostgresJobQueue, runWorker } from "@/services/jobs/queue";
import { processConversationJob } from "@/services/ai/conversation";

const queue = new PostgresJobQueue();
const controller = new AbortController();
process.on("SIGTERM", () => controller.abort());
process.on("SIGINT", () => controller.abort());
logger.info("worker.ready");
void runWorker(queue, async (job) => {
  if (job.type === "PROCESS_CONVERSATION") await processConversationJob(job);
}, { signal: controller.signal }).catch((error) => { logger.error({ error: error instanceof Error ? error.message : "worker failure" }, "worker.stopped"); process.exitCode = 1; });
