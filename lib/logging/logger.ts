import pino from "pino";

export const logger = pino({ name: "growthifyx-ai-sales", level: process.env.LOG_LEVEL ?? "info" });

export function redactSensitiveText(value: string) {
  return value
    .replace(/(bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/((?:api[_-]?key|access[_-]?token|bot[_-]?token|password|secret)\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/(EA[A-Za-z0-9_-]{20,})/g, "[REDACTED_META_TOKEN]")
    .replace(/(sk-[A-Za-z0-9_-]{20,})/g, "[REDACTED_API_KEY]");
}
