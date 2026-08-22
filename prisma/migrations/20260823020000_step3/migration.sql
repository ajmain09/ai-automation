-- Step 3 additive order, delivery, recovery, and readiness fields.
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED_RETRYABLE', 'FAILED_PERMANENT', 'DEAD_LETTER');

ALTER TABLE "Page" ADD COLUMN "lifecycleStatus" TEXT NOT NULL DEFAULT 'DRAFT', ADD COLUMN "readinessCheckedAt" TIMESTAMP(3);
ALTER TABLE "PageSettings" ADD COLUMN "telegramEnabled" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "encryptedTelegramBotToken" TEXT, ADD COLUMN "telegramChatId" TEXT;
ALTER TABLE "Customer" ADD COLUMN "phoneOriginal" TEXT;
ALTER TABLE "OrderSession" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE', ADD COLUMN "orderId" UUID;
ALTER TABLE "Order" ADD COLUMN "orderSessionId" UUID, ADD COLUMN "productId" UUID, ADD COLUMN "productName" TEXT, ADD COLUMN "variantId" UUID, ADD COLUMN "variantDetails" JSONB, ADD COLUMN "unitPrice" DECIMAL(12,2), ADD COLUMN "quantity" INTEGER, ADD COLUMN "currency" TEXT, ADD COLUMN "customerName" TEXT, ADD COLUMN "normalizedPhone" TEXT, ADD COLUMN "phoneOriginal" TEXT, ADD COLUMN "fullAddress" TEXT, ADD COLUMN "configurationVersion" INTEGER, ADD COLUMN "confirmedAt" TIMESTAMP(3);
UPDATE "Order" SET "orderSessionId" = (md5("id"::text || clock_timestamp()::text))::uuid WHERE "orderSessionId" IS NULL;
ALTER TABLE "Order" ALTER COLUMN "orderSessionId" SET NOT NULL;
ALTER TABLE "OrderRevision" ADD COLUMN "eventType" TEXT NOT NULL DEFAULT 'UPDATED', ADD COLUMN "changedFields" JSONB;
ALTER TABLE "DeliveryOutbox" ADD COLUMN "eventType" TEXT NOT NULL DEFAULT 'NEW_ORDER', ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING', ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "maxAttempts" INTEGER NOT NULL DEFAULT 8, ADD COLUMN "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, ADD COLUMN "leaseUntil" TIMESTAMP(3), ADD COLUMN "lastError" TEXT;
ALTER TABLE "Issue" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'GENERAL', ADD COLUMN "resolutionAction" TEXT;

CREATE TABLE "AdminRecoveryToken" (
  "id" UUID NOT NULL,
  "adminId" UUID NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminRecoveryToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdminRecoveryToken_tokenHash_key" ON "AdminRecoveryToken"("tokenHash");
CREATE INDEX "AdminRecoveryToken_adminId_expiresAt_idx" ON "AdminRecoveryToken"("adminId", "expiresAt");
CREATE INDEX "OrderSession_pageId_customerId_status_idx" ON "OrderSession"("pageId", "customerId", "status");
ALTER TABLE "AdminRecoveryToken" ADD CONSTRAINT "AdminRecoveryToken_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE CASCADE ON UPDATE CASCADE;
