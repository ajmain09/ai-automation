-- Lock the architecture: AI, Telegram, pricing, FX and budgets belong to one Page.
ALTER TABLE "Page" ADD COLUMN "aiStatus" TEXT NOT NULL DEFAULT 'PAUSED';

ALTER TABLE "PageSettings"
  DROP COLUMN IF EXISTS "globalAiPaused",
  DROP COLUMN IF EXISTS "telegramEnabled",
  DROP COLUMN IF EXISTS "encryptedTelegramBotToken",
  DROP COLUMN IF EXISTS "telegramChatId";

ALTER TABLE "PageAiSettings"
  DROP COLUMN IF EXISTS "modelOverride",
  ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'deepseek',
  ADD COLUMN "encryptedApiKey" TEXT,
  ADD COLUMN "baseUrl" TEXT NOT NULL DEFAULT 'https://api.deepseek.com',
  ADD COLUMN "model" TEXT NOT NULL DEFAULT 'deepseek-v4-flash',
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
  ADD COLUMN "providerBalanceUsd" DECIMAL(14,8),
  ADD COLUMN "providerBalanceCny" DECIMAL(14,8),
  ADD COLUMN "providerBalancePayload" JSONB,
  ADD COLUMN "lastBalanceCheckAt" TIMESTAMP(3),
  ADD COLUMN "lastSuccessfulCallAt" TIMESTAMP(3),
  ADD COLUMN "lastFailedCallAt" TIMESTAMP(3),
  ADD COLUMN "lastError" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "PageAiBudget" RENAME TO "PageCostSettings";
ALTER TABLE "PageCostSettings"
  DROP COLUMN IF EXISTS "useMasterSettings",
  DROP COLUMN IF EXISTS "maxOutputTokens",
  DROP COLUMN IF EXISTS "modelOverride",
  ADD COLUMN "usdBdtRate" DECIMAL(14,6) NOT NULL DEFAULT 120;

CREATE TABLE "PageTelegramSettings" (
  "id" UUID NOT NULL,
  "pageId" UUID NOT NULL,
  "encryptedBotToken" TEXT,
  "chatId" TEXT,
  "newOrderEnabled" BOOLEAN NOT NULL DEFAULT true,
  "updatedOrderEnabled" BOOLEAN NOT NULL DEFAULT true,
  "cancelledOrderEnabled" BOOLEAN NOT NULL DEFAULT true,
  "status" TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
  "lastError" TEXT,
  "lastTestAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PageTelegramSettings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PageTelegramSettings_pageId_key" ON "PageTelegramSettings"("pageId");
ALTER TABLE "PageTelegramSettings" ADD CONSTRAINT "PageTelegramSettings_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiPricingProfile" RENAME TO "PageAiPricingProfile";
ALTER TABLE "PageAiPricingProfile" ADD COLUMN "pageId" UUID;
ALTER TABLE "PageAiPricingProfile" DROP CONSTRAINT IF EXISTS "AiPricingProfile_pkey";
ALTER TABLE "PageAiPricingProfile" ADD CONSTRAINT "PageAiPricingProfile_pkey" PRIMARY KEY ("id");
DROP INDEX IF EXISTS "AiPricingProfile_model_effectiveFrom_idx";
-- Old global pricing rows cannot be safely assigned to a Page; recreate them per Page in onboarding.
DELETE FROM "PageAiPricingProfile";
CREATE UNIQUE INDEX "PageAiPricingProfile_pageId_model_key" ON "PageAiPricingProfile"("pageId", "model");
CREATE INDEX "PageAiPricingProfile_pageId_model_effectiveFrom_idx" ON "PageAiPricingProfile"("pageId", "model", "effectiveFrom");
ALTER TABLE "PageAiPricingProfile" ALTER COLUMN "pageId" SET NOT NULL;
ALTER TABLE "PageAiPricingProfile" ADD CONSTRAINT "PageAiPricingProfile_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "PageCostSettings"("pageId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ApiUsage" DROP CONSTRAINT IF EXISTS "ApiUsage_pricingProfileId_fkey";
ALTER TABLE "ApiUsage" ADD CONSTRAINT "ApiUsage_pricingProfileId_fkey" FOREIGN KEY ("pricingProfileId") REFERENCES "PageAiPricingProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP TABLE IF EXISTS "AiProviderSetting";
DROP TABLE IF EXISTS "TelegramSetting";
DROP TABLE IF EXISTS "FxRateSetting";
DROP TABLE IF EXISTS "GlobalAiBudget";
DELETE FROM "SystemSetting" WHERE "key" IN ('global_ai_paused', 'telegram_global_destination');
