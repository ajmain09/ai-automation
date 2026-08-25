ALTER TABLE "AiRun" ADD COLUMN "cachedInputTokens" INTEGER;
ALTER TABLE "AiRun" ADD COLUMN "providerUsageJson" JSONB;
ALTER TABLE "ApiUsage" ADD COLUMN "cachedInputTokens" INTEGER;
ALTER TABLE "ApiUsage" ADD COLUMN "inputHitRateSnapshot" DECIMAL(12,8);
ALTER TABLE "ApiUsage" ADD COLUMN "inputMissRateSnapshot" DECIMAL(12,8);
ALTER TABLE "ApiUsage" ADD COLUMN "usdBdtRateSnapshot" DECIMAL(12,8);
ALTER TABLE "ApiUsage" ADD COLUMN "estimatedCostUsd" DECIMAL(14,8);
ALTER TABLE "ApiUsage" ADD COLUMN "estimatedCostBdt" DECIMAL(14,6);
ALTER TABLE "ApiUsage" ADD COLUMN "costEstimated" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ApiUsage" ADD COLUMN "pricingProfileId" UUID;

CREATE TABLE "PageAiSettings" (
  "id" UUID NOT NULL,
  "pageId" UUID NOT NULL,
  "language" TEXT NOT NULL DEFAULT 'auto', "tone" TEXT NOT NULL DEFAULT 'natural_sales', "replyLength" TEXT NOT NULL DEFAULT 'short',
  "modelOverride" TEXT, "thinkingOverride" TEXT, "maxOutputTokens" INTEGER,
  "understandBeforeRecommend" BOOLEAN NOT NULL DEFAULT true, "suggestCombo" BOOLEAN NOT NULL DEFAULT true, "askOneQuestionAtATime" BOOLEAN NOT NULL DEFAULT true,
  "mirrorCustomerLanguage" BOOLEAN NOT NULL DEFAULT true, "customerMemory" BOOLEAN NOT NULL DEFAULT true, "recentMessageContext" INTEGER NOT NULL DEFAULT 12,
  "rollingSummary" BOOLEAN NOT NULL DEFAULT true, "smartBuffer" BOOLEAN NOT NULL DEFAULT true, "bufferWindowSeconds" INTEGER NOT NULL DEFAULT 8,
  "manualCollisionProtection" BOOLEAN NOT NULL DEFAULT true, "manualActivityCooldown" INTEGER NOT NULL DEFAULT 30, "customSalesInstructions" TEXT,
  CONSTRAINT "PageAiSettings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PageAiSettings_pageId_key" ON "PageAiSettings"("pageId");
ALTER TABLE "PageAiSettings" ADD CONSTRAINT "PageAiSettings_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PageAiBudget" (
  "id" UUID NOT NULL, "pageId" UUID NOT NULL, "useMasterSettings" BOOLEAN NOT NULL DEFAULT true,
  "monthlyBudgetBdt" DECIMAL(14,2), "dailyBudgetBdt" DECIMAL(14,2), "hardLimit" BOOLEAN NOT NULL DEFAULT false,
  "warningThreshold" INTEGER NOT NULL DEFAULT 85, "maxOutputTokens" INTEGER, "modelOverride" TEXT,
  "pausedByBudget" BOOLEAN NOT NULL DEFAULT false, "reservedBdt" DECIMAL(14,6) NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PageAiBudget_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PageAiBudget_pageId_key" ON "PageAiBudget"("pageId");
ALTER TABLE "PageAiBudget" ADD CONSTRAINT "PageAiBudget_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MetaPlatformSetting" (
  "id" UUID NOT NULL, "appId" TEXT, "appSecretEncrypted" TEXT, "verifyTokenEncrypted" TEXT, "graphApiVersion" TEXT NOT NULL DEFAULT 'v23.0',
  "oauthRedirectUri" TEXT, "webhookUrl" TEXT, "status" TEXT NOT NULL DEFAULT 'NOT_CONFIGURED', "lastApiTestAt" TIMESTAMP(3), "lastError" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "MetaPlatformSetting_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AiProviderSetting" (
  "id" UUID NOT NULL, "provider" TEXT NOT NULL DEFAULT 'deepseek', "apiKeyEncrypted" TEXT, "baseUrl" TEXT NOT NULL DEFAULT 'https://api.deepseek.com',
  "defaultModel" TEXT NOT NULL DEFAULT 'deepseek-v4-flash', "thinkingMode" TEXT NOT NULL DEFAULT 'off', "reasoningEffort" TEXT,
  "maxOutputTokens" INTEGER NOT NULL DEFAULT 700, "requestTimeoutMs" INTEGER NOT NULL DEFAULT 30000, "retryCount" INTEGER NOT NULL DEFAULT 1, "concurrencyLimit" INTEGER NOT NULL DEFAULT 4,
  "status" TEXT NOT NULL DEFAULT 'NOT_CONFIGURED', "balanceUsd" DECIMAL(14,8), "balanceCny" DECIMAL(14,8), "balancePayload" JSONB,
  "lastSuccessfulCallAt" TIMESTAMP(3), "lastFailedCallAt" TIMESTAMP(3), "lastBalanceCheckAt" TIMESTAMP(3), "lastError" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "AiProviderSetting_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AiProviderSetting_provider_key" ON "AiProviderSetting"("provider");
CREATE TABLE "TelegramSetting" (
  "id" UUID NOT NULL, "botTokenEncrypted" TEXT, "defaultChatId" TEXT, "defaultParseMode" TEXT, "status" TEXT NOT NULL DEFAULT 'NOT_CONFIGURED', "lastError" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "TelegramSetting_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "FxRateSetting" (
  "id" UUID NOT NULL, "pair" TEXT NOT NULL DEFAULT 'USD_BDT', "rate" DECIMAL(14,6) NOT NULL, "source" TEXT NOT NULL DEFAULT 'MANUAL',
  "updatedAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "FxRateSetting_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FxRateSetting_pair_key" ON "FxRateSetting"("pair");
CREATE TABLE "AiPricingProfile" (
  "id" UUID NOT NULL, "model" TEXT NOT NULL, "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "inputCacheHitPerMillionUsd" DECIMAL(14,8) NOT NULL, "inputCacheMissPerMillionUsd" DECIMAL(14,8) NOT NULL, "outputPerMillionUsd" DECIMAL(14,8) NOT NULL,
  "peakMultiplier" DECIMAL(8,4), "peakScheduleEnabled" BOOLEAN NOT NULL DEFAULT false, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiPricingProfile_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AiPricingProfile_model_effectiveFrom_idx" ON "AiPricingProfile"("model", "effectiveFrom");
CREATE TABLE "GlobalAiBudget" (
  "id" UUID NOT NULL, "monthlyBudgetBdt" DECIMAL(14,2), "dailyBudgetBdt" DECIMAL(14,2), "hardLimit" BOOLEAN NOT NULL DEFAULT false, "warningThreshold" INTEGER NOT NULL DEFAULT 85,
  "reservedBdt" DECIMAL(14,6) NOT NULL DEFAULT 0, "updatedAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GlobalAiBudget_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "ApiUsage" ADD CONSTRAINT "ApiUsage_pricingProfileId_fkey" FOREIGN KEY ("pricingProfileId") REFERENCES "AiPricingProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
