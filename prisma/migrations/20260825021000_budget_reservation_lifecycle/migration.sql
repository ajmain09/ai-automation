CREATE TYPE "BudgetReservationStatus" AS ENUM ('RESERVED', 'SETTLED', 'RELEASED', 'EXPIRED');

CREATE TABLE "AiBudgetReservation" (
  "id" UUID NOT NULL,
  "pageId" UUID NOT NULL,
  "reservationKey" TEXT NOT NULL,
  "aiAttemptId" TEXT,
  "estimatedBdt" DECIMAL(14,6) NOT NULL,
  "settledBdt" DECIMAL(14,6),
  "status" "BudgetReservationStatus" NOT NULL DEFAULT 'RESERVED',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiBudgetReservation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AiBudgetReservation_reservationKey_key" ON "AiBudgetReservation"("reservationKey");
CREATE UNIQUE INDEX "AiBudgetReservation_aiAttemptId_key" ON "AiBudgetReservation"("aiAttemptId");
CREATE INDEX "AiBudgetReservation_pageId_status_expiresAt_idx" ON "AiBudgetReservation"("pageId", "status", "expiresAt");
ALTER TABLE "AiBudgetReservation" ADD CONSTRAINT "AiBudgetReservation_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
