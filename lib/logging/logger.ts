import pino from "pino";

export const logger = pino({ name: "growthifyx-ai-sales", level: process.env.LOG_LEVEL ?? "info" });
