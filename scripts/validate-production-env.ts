import fs from "node:fs";
import path from "node:path";
import { getEnv } from "../lib/env";

const PRODUCTION_URL = "https://ai.growthifyx.space";
const META_REDIRECT_URI = `${PRODUCTION_URL}/api/meta/oauth/callback`;
const META_WEBHOOK_URL = `${PRODUCTION_URL}/api/meta/webhook`;
const PLACEHOLDER = /^(?:replace-with|change-me|change-this|your-|example|local-development-only)/i;

function unquote(value: string) {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function readEnvFile(filePath: string) {
  const values: Record<string, string> = {};
  const source = fs.readFileSync(filePath, "utf8");
  for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) throw new Error(`Invalid .env syntax at ${filePath}:${index + 1}`);
    values[match[1]] = unquote(match[2]);
  }
  return values;
}

function fail(message: string): never {
  throw new Error(`Production environment invalid: ${message}`);
}

function validateProduction(workerMode: boolean) {
  const env = getEnv();
  if (env.NODE_ENV !== "production") fail("NODE_ENV must be production");
  if (env.DEV_PREVIEW) fail("DEV_PREVIEW must be false");
  if (env.APP_URL !== PRODUCTION_URL) fail(`APP_URL must be ${PRODUCTION_URL}`);
  if (env.META_REDIRECT_URI !== META_REDIRECT_URI) fail(`META_REDIRECT_URI must be ${META_REDIRECT_URI}`);
  if (env.META_WEBHOOK_URL !== META_WEBHOOK_URL) fail(`META_WEBHOOK_URL must be ${META_WEBHOOK_URL}`);
  if (env.SESSION_SECRET === env.APP_ENCRYPTION_KEY) fail("SESSION_SECRET and APP_ENCRYPTION_KEY must differ");
  if (PLACEHOLDER.test(env.SESSION_SECRET ?? "")) fail("SESSION_SECRET is still a placeholder");
  if (PLACEHOLDER.test(env.APP_ENCRYPTION_KEY ?? "")) fail("APP_ENCRYPTION_KEY is still a placeholder");
  if (!workerMode && !env.ADMIN_EMAIL) fail("ADMIN_EMAIL is required for the Super Admin bootstrap");

  const databaseUrl = new URL(env.DATABASE_URL!);
  if (databaseUrl.protocol !== "postgresql:") fail("DATABASE_URL must use postgresql://");
  if (databaseUrl.hostname !== "postgres") fail("DATABASE_URL hostname must be postgres inside Compose");
  if (databaseUrl.port && databaseUrl.port !== "5432") fail("DATABASE_URL must use PostgreSQL port 5432");
  if (databaseUrl.username !== "growthifyx") fail("DATABASE_URL must use the growthifyx database user");

  const domain = process.env.CADDY_DOMAIN;
  if (domain && domain !== "ai.growthifyx.space") fail("CADDY_DOMAIN must be ai.growthifyx.space");
  for (const key of ["DEEPSEEK_API_KEY", "TELEGRAM_BOT_TOKEN", "META_PAGE_ACCESS_TOKEN"]) {
    if (process.env[key]) fail(`${key} is not allowed in the production environment; configure credentials per Page or through the Meta settings boundary`);
  }
}

function validateTemplate(filePath: string) {
  const values = readEnvFile(filePath);
  Object.assign(process.env, values, {
    NODE_ENV: "production",
    DEV_PREVIEW: "false",
    POSTGRES_PASSWORD: "template-only-postgres-password",
    DATABASE_URL: "postgresql://growthifyx:template-only-postgres-password@postgres:5432/growthifyx?schema=public",
    SESSION_SECRET: "template-only-session-secret-012345678901234567890123456789",
    APP_ENCRYPTION_KEY: "template-only-encryption-key-012345678901234567890123456789",
    ADMIN_EMAIL: "admin@example.com",
    META_REDIRECT_URI,
    META_WEBHOOK_URL,
    CADDY_DOMAIN: "ai.growthifyx.space",
  });
  validateProduction(false);
}

const argument = process.argv[2];
try {
  if (argument === "--environment") {
    validateProduction(process.argv.includes("--worker"));
  } else {
    const filePath = path.resolve(argument ?? ".env");
    if (!fs.existsSync(filePath)) fail(`environment file not found: ${filePath}`);
    validateTemplate(filePath);
  }
  console.log("Production environment validation passed.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Production environment validation failed.");
  process.exitCode = 1;
}
