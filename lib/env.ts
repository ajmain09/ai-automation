import { z } from "zod";

const PLACEHOLDER = /^(?:replace-with|change-me|change-this|your-|example|local-development-only)/i;
const PRODUCTION_URL = "https://ai.growthifyx.space";
const PRODUCTION_META_REDIRECT = `${PRODUCTION_URL}/api/meta/oauth/callback`;
const PRODUCTION_META_WEBHOOK = `${PRODUCTION_URL}/api/meta/webhook`;

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().optional(),
  DEV_PREVIEW: z.preprocess((value) => value === true || value === "true", z.boolean()).default(false),
  PREVIEW_ADMIN_EMAIL: z.string().email().optional(),
  PREVIEW_ADMIN_PASSWORD: z.string().min(8).optional(),
  DATABASE_URL: z.string().optional(),
  SESSION_SECRET: z.string().optional(),
  ADMIN_EMAIL: z.string().email().optional(),
  APP_ENCRYPTION_KEY: z.string().optional(),
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_VERIFY_TOKEN: z.preprocess((value) => value === "" ? undefined : value, z.string().min(16).optional()),
  META_LOGIN_CONFIG_ID: z.string().trim().optional(),
  META_REDIRECT_URI: z.string().url().optional(),
  META_WEBHOOK_URL: z.string().url().optional(),
  META_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v23.0"),
}).superRefine((value, context) => {
  const preview = value.NODE_ENV === "development" && value.DEV_PREVIEW;
  const requireValue = (key: keyof typeof value, message: string) => {
    const current = value[key];
    if (typeof current !== "string" || !current.trim()) context.addIssue({ code: z.ZodIssueCode.custom, path: [key], message });
  };

  if (value.NODE_ENV === "production" && value.DEV_PREVIEW) context.addIssue({ code: z.ZodIssueCode.custom, path: ["DEV_PREVIEW"], message: "DEV_PREVIEW cannot be enabled in production" });

  if (preview) {
    requireValue("PREVIEW_ADMIN_EMAIL", "Preview admin email is required when DEV_PREVIEW is enabled");
    requireValue("PREVIEW_ADMIN_PASSWORD", "Preview admin password is required when DEV_PREVIEW is enabled");
    requireValue("SESSION_SECRET", "SESSION_SECRET is required when DEV_PREVIEW is enabled");
    if (value.SESSION_SECRET && (value.SESSION_SECRET.length < 32 || PLACEHOLDER.test(value.SESSION_SECRET))) context.addIssue({ code: z.ZodIssueCode.custom, path: ["SESSION_SECRET"], message: "Preview SESSION_SECRET must be at least 32 non-placeholder characters" });
    return;
  }

  if (value.NODE_ENV === "test") return;

  requireValue("DATABASE_URL", "DATABASE_URL is required outside database-free preview");
  requireValue("SESSION_SECRET", "SESSION_SECRET is required outside database-free preview");
  requireValue("APP_ENCRYPTION_KEY", "APP_ENCRYPTION_KEY is required outside database-free preview");
  if (value.SESSION_SECRET && (value.SESSION_SECRET.length < 32 || PLACEHOLDER.test(value.SESSION_SECRET))) context.addIssue({ code: z.ZodIssueCode.custom, path: ["SESSION_SECRET"], message: "SESSION_SECRET must be at least 32 non-placeholder characters" });
  if (value.APP_ENCRYPTION_KEY && (value.APP_ENCRYPTION_KEY.length < 32 || PLACEHOLDER.test(value.APP_ENCRYPTION_KEY))) context.addIssue({ code: z.ZodIssueCode.custom, path: ["APP_ENCRYPTION_KEY"], message: "APP_ENCRYPTION_KEY must be at least 32 non-placeholder characters" });
  if (!value.DATABASE_URL?.startsWith("postgresql://") || /change-me|localhost|URL_ENCODED_PASSWORD/i.test(value.DATABASE_URL ?? "")) context.addIssue({ code: z.ZodIssueCode.custom, path: ["DATABASE_URL"], message: "DATABASE_URL must point to the production PostgreSQL service" });

  if (value.NODE_ENV === "production") {
    if (value.APP_URL !== PRODUCTION_URL) context.addIssue({ code: z.ZodIssueCode.custom, path: ["APP_URL"], message: `Production APP_URL must be ${PRODUCTION_URL}` });
    if (value.META_REDIRECT_URI && value.META_REDIRECT_URI !== PRODUCTION_META_REDIRECT) context.addIssue({ code: z.ZodIssueCode.custom, path: ["META_REDIRECT_URI"], message: `Production Meta redirect URI must be ${PRODUCTION_META_REDIRECT}` });
    if (value.META_WEBHOOK_URL && value.META_WEBHOOK_URL !== PRODUCTION_META_WEBHOOK) context.addIssue({ code: z.ZodIssueCode.custom, path: ["META_WEBHOOK_URL"], message: `Production Meta webhook URL must be ${PRODUCTION_META_WEBHOOK}` });
    if (value.META_VERIFY_TOKEN && PLACEHOLDER.test(value.META_VERIFY_TOKEN)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["META_VERIFY_TOKEN"], message: "META_VERIFY_TOKEN must be replaced" });
    if (value.ADMIN_EMAIL?.toLowerCase() === "admin@local.test") context.addIssue({ code: z.ZodIssueCode.custom, path: ["ADMIN_EMAIL"], message: "Local preview credentials are forbidden in production" });
  }
});

export type AppEnv = z.infer<typeof envSchema>;

export function getEnv(): AppEnv {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return { ...parsed.data, APP_URL: parsed.data.APP_URL ?? (parsed.data.NODE_ENV === "production" ? PRODUCTION_URL : "http://localhost:3000") };
}

export function isDevPreview() {
  const env = getEnv();
  return env.NODE_ENV === "development" && env.DEV_PREVIEW;
}

export const canonicalUrls = { app: PRODUCTION_URL, metaRedirect: PRODUCTION_META_REDIRECT, metaWebhook: PRODUCTION_META_WEBHOOK, privacy: `${PRODUCTION_URL}/privacy`, dataDeletion: `${PRODUCTION_URL}/data-deletion` } as const;
