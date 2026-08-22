import { z } from "zod";

export const businessSetupSchema = z.object({
  pageId: z.string().uuid(),
  rawBusinessInfo: z.string().trim().min(10).max(20000),
  businessName: z.string().trim().max(160).optional().default(""),
  description: z.string().trim().max(4000).optional().default(""),
  benefits: z.string().trim().max(4000).optional().default(""),
  deliveryPolicy: z.string().trim().max(4000).optional().default(""),
  codPolicy: z.string().trim().max(4000).optional().default(""),
  faq: z.string().trim().max(4000).optional().default(""),
  salesInstructions: z.string().trim().max(4000).optional().default(""),
  notes: z.string().trim().max(4000).optional().default(""),
});

export const productSchema = z.object({
  pageId: z.string().uuid(), name: z.string().trim().min(1).max(160), description: z.string().trim().max(4000).optional().default(""),
  sku: z.string().trim().min(1).max(80), price: z.coerce.number().nonnegative().max(100000000), oldPrice: z.coerce.number().nonnegative().max(100000000).optional(),
  size: z.string().trim().max(80).optional().default(""), color: z.string().trim().max(80).optional().default(""),
});
