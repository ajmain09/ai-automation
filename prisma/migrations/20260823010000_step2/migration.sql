-- CreateEnum
CREATE TYPE "OutboundStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'UNKNOWN_DELIVERY', 'FAILED_RETRYABLE', 'FAILED_PERMANENT');

-- CreateEnum
CREATE TYPE "AiCallType" AS ENUM ('CHAT_REPLY', 'BUSINESS_PARSE', 'MEMORY_SUMMARY', 'PRELIVE_TEST', 'RETRY');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "JobStatus" ADD VALUE 'DEAD_LETTER';
ALTER TYPE "JobStatus" ADD VALUE 'EXPIRED';

-- AlterTable
ALTER TABLE "PageConnection" ADD COLUMN     "lastHealthCheckAt" TIMESTAMP(3),
ADD COLUMN     "lastHealthCheckStatus" TEXT,
ADD COLUMN     "subscribedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ConfigurationVersion" ADD COLUMN     "businessData" JSONB,
ADD COLUMN     "conflicts" JSONB,
ADD COLUMN     "parseStatus" TEXT;

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "bufferUntil" TIMESTAMP(3),
ADD COLUMN     "lastCustomerMessageAt" TIMESTAMP(3),
ADD COLUMN     "lastManualReplyAt" TIMESTAMP(3),
ADD COLUMN     "manualReplyUntil" TIMESTAMP(3),
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "isEcho" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "senderPsid" TEXT;

-- AlterTable
ALTER TABLE "WebhookEvent" ADD COLUMN     "eventType" TEXT,
ADD COLUMN     "ignoredReason" TEXT,
ADD COLUMN     "signatureValid" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "conversationId" UUID,
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "leaseUntil" TIMESTAMP(3),
ADD COLUMN     "lockedAt" TIMESTAMP(3),
ADD COLUMN     "maxAttempts" INTEGER NOT NULL DEFAULT 5;

-- AlterTable
ALTER TABLE "OutboundMessage" ADD COLUMN     "conversationId" UUID,
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "sentAt" TIMESTAMP(3),
ADD COLUMN     "status" "OutboundStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "AiRun" ADD COLUMN     "attemptNumber" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "callType" "AiCallType" NOT NULL DEFAULT 'CHAT_REPLY',
ADD COLUMN     "errorCode" TEXT,
ADD COLUMN     "latencyMs" INTEGER,
ADD COLUMN     "providerRequestId" TEXT,
ADD COLUMN     "totalTokens" INTEGER;

-- AlterTable
ALTER TABLE "ApiUsage" ADD COLUMN     "attemptNumber" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "callType" "AiCallType" NOT NULL DEFAULT 'CHAT_REPLY',
ADD COLUMN     "inputRateSnapshot" DECIMAL(12,8),
ADD COLUMN     "latencyMs" INTEGER,
ADD COLUMN     "outputRateSnapshot" DECIMAL(12,8),
ADD COLUMN     "providerRequestId" TEXT,
ADD COLUMN     "providerUsageJson" JSONB,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'SUCCEEDED',
ADD COLUMN     "totalTokens" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "OutboundMessage" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "AiRun" ALTER COLUMN "callType" DROP DEFAULT;
ALTER TABLE "ApiUsage" ALTER COLUMN "callType" DROP DEFAULT;

-- CreateTable
CREATE TABLE "OAuthState" (
    "id" UUID NOT NULL,
    "stateHash" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "encryptedUserToken" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "OAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OAuthState_stateHash_key" ON "OAuthState"("stateHash");

-- CreateIndex
CREATE UNIQUE INDEX "Job_idempotencyKey_key" ON "Job"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Job_conversationId_status_runAt_idx" ON "Job"("conversationId", "status", "runAt");

-- CreateIndex
CREATE INDEX "Job_expiresAt_status_idx" ON "Job"("expiresAt", "status");

-- CreateIndex
CREATE INDEX "OutboundMessage_pageId_status_createdAt_idx" ON "OutboundMessage"("pageId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

