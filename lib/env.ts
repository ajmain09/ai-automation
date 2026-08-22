import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url().or(z.string().startsWith("postgresql://")),
  SESSION_SECRET: z.string().min(32),
  APP_URL: z.string().url().default("https://ai.growthifyx.space"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(12).optional(),
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_REDIRECT_URI: z.string().url().optional(),
  META_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/).optional(),
  META_VERIFY_TOKEN: z.string().min(16).optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_MODEL: z.string().default("deepseek-chat"),
  DEEPSEEK_BASE_URL: z.string().url().default("https://api.deepseek.com"),
  DEEPSEEK_INPUT_RATE: z.coerce.number().nonnegative().default(0),
  DEEPSEEK_OUTPUT_RATE: z.coerce.number().nonnegative().default(0),
  TELEGRAM_DEFAULT_BOT_TOKEN: z.string().optional(),
  TELEGRAM_DEFAULT_CHAT_ID: z.string().optional(),
}).superRefine((value, context) => {
  if (value.NODE_ENV !== "production") return;
  if (value.APP_URL !== "https://ai.growthifyx.space") context.addIssue({ code: z.ZodIssueCode.custom, path: ["APP_URL"], message: "Production APP_URL must be https://ai.growthifyx.space" });
  if (!value.DATABASE_URL.startsWith("postgresql://") || /change-me|localhost/i.test(value.DATABASE_URL)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["DATABASE_URL"], message: "Production DATABASE_URL must point to PostgreSQL" });
  if (/replace-with|change-this|change-me/i.test(value.SESSION_SECRET)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["SESSION_SECRET"], message: "Production SESSION_SECRET must be replaced" });
  for (const key of ["META_APP_ID", "META_APP_SECRET", "META_REDIRECT_URI", "META_GRAPH_VERSION", "META_VERIFY_TOKEN", "DEEPSEEK_API_KEY"] as const) {
    if (!value[key]) context.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: "Required in production" });
  }
  if (value.META_REDIRECT_URI !== "https://ai.growthifyx.space/api/meta/oauth/callback") context.addIssue({ code: z.ZodIssueCode.custom, path: ["META_REDIRECT_URI"], message: "Production Meta redirect URI must use the canonical callback" });
  if (value.META_VERIFY_TOKEN && /replace-with|change-me/i.test(value.META_VERIFY_TOKEN)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["META_VERIFY_TOKEN"], message: "Production Meta verify token must be replaced" });
  if (!value.ADMIN_EMAIL || !value.ADMIN_PASSWORD || /replace-with|change-this|change-me/i.test(value.ADMIN_PASSWORD)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["ADMIN_PASSWORD"], message: "Explicit production admin bootstrap credentials are required" });
});

let cached: z.infer<typeof envSchema> | undefined;
export function getEnv() {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) throw new Error(`Invalid environment: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
  cached = parsed.data;
  return cached;
}
