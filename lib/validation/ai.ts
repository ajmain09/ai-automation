import { z } from "zod";

export const factUpdateSchema = z.object({
  key: z.string().trim().min(1).max(80),
  value: z.unknown(),
  operation: z.enum(["SET", "CORRECT", "CLEAR"]).default("SET"),
  confidence: z.number().min(0).max(1).optional(),
});

export const aiResponseSchema = z.object({
  intent: z.string().trim().min(1).max(80),
  reply: z.string().trim().min(1).max(4000),
  fact_updates: z.array(factUpdateSchema).max(20).default([]),
  asked_question_key: z.string().trim().max(80).nullable().optional(),
  recommended_product_ids: z.array(z.string().uuid()).max(10).default([]),
  order_action: z.enum(["NONE", "START", "UPDATE", "CONFIRM"]).default("NONE"),
});

export type AiResponse = z.infer<typeof aiResponseSchema>;

export function parseAiResponse(value: unknown) {
  return aiResponseSchema.safeParse(value);
}

export const businessParseSchema = z.object({
  business_profile: z.object({
    business_name: z.string().max(160).nullable().default(null),
    description: z.string().max(4000).nullable().default(null),
    benefits: z.array(z.string().max(500)).max(50).default([]),
  }).default({}),
  products: z.array(z.object({
    name: z.string().min(1).max(160),
    description: z.string().max(4000).nullable().default(null),
    tags: z.array(z.string().max(80)).max(30).default([]),
    variants: z.array(z.object({
      sku: z.string().min(1).max(80),
      size: z.string().max(80).nullable().default(null),
      color: z.string().max(80).nullable().default(null),
      current_price: z.number().nonnegative(),
      old_price: z.number().nonnegative().nullable().default(null),
    })).max(100).default([]),
  })).max(500).default([]),
  policies: z.object({
    delivery: z.string().max(4000).nullable().default(null),
    cod: z.string().max(4000).nullable().default(null),
    faq: z.array(z.string().max(1000)).max(100).default([]),
  }).default({}),
  sales_instructions: z.string().max(4000).nullable().default(null),
  order_requirements: z.array(z.string().max(80)).max(30).default([]),
  unknown_information: z.array(z.string().max(500)).max(100).default([]),
  conflicts: z.array(z.object({
    field: z.string().max(120),
    details: z.string().max(1000),
    critical: z.boolean().default(false),
  })).max(100).default([]),
});

export type BusinessParse = z.infer<typeof businessParseSchema>;
