-- Additive memory hardening. Existing JSON memory remains intact and is used as a
-- compatibility projection while fact history is recorded in this table.
CREATE TYPE "MemoryFactStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'REJECTED', 'UNCONFIRMED');

ALTER TABLE "CustomerMemory"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "summaryVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "summaryLastMessageId" UUID,
  ADD COLUMN "summaryGeneratedAt" TIMESTAMP(3),
  ADD COLUMN "summaryStale" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "CustomerMemoryFact" (
  "id" UUID NOT NULL,
  "pageId" UUID NOT NULL,
  "customerId" UUID NOT NULL,
  "factKey" TEXT NOT NULL,
  "normalizedValue" JSONB NOT NULL,
  "displayValue" TEXT,
  "sourceMessageId" UUID,
  "sourceType" TEXT NOT NULL DEFAULT 'AI_EXTRACTION',
  "confidence" DECIMAL(5,4),
  "status" "MemoryFactStatus" NOT NULL DEFAULT 'ACTIVE',
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastConfirmedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "supersededByFactId" UUID,
  CONSTRAINT "CustomerMemoryFact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerMemoryFact_customerId_sourceMessageId_factKey_key"
  ON "CustomerMemoryFact"("customerId", "sourceMessageId", "factKey");
CREATE INDEX "CustomerMemoryFact_pageId_customerId_factKey_status_idx"
  ON "CustomerMemoryFact"("pageId", "customerId", "factKey", "status");
CREATE INDEX "CustomerMemoryFact_pageId_customerId_updatedAt_idx"
  ON "CustomerMemoryFact"("pageId", "customerId", "updatedAt");
CREATE INDEX "CustomerMemoryFact_sourceMessageId_idx"
  ON "CustomerMemoryFact"("sourceMessageId");

ALTER TABLE "CustomerMemoryFact"
  ADD CONSTRAINT "CustomerMemoryFact_pageId_fkey"
    FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CustomerMemoryFact_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CustomerMemoryFact_sourceMessageId_fkey"
    FOREIGN KEY ("sourceMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "CustomerMemoryFact_supersededByFactId_fkey"
    FOREIGN KEY ("supersededByFactId") REFERENCES "CustomerMemoryFact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
