import { logger } from "@/lib/logging/logger";

// Step 1 worker boundary. Future jobs will be read from PostgreSQL and executed here.
logger.info("worker.ready");
