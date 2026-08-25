CREATE TABLE "DataDeletionRequest" (
    "id" UUID NOT NULL,
    "requestKey" TEXT NOT NULL,
    "pageId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "ordersPreserved" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DataDeletionRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DataDeletionRequest_requestKey_key" ON "DataDeletionRequest"("requestKey");
CREATE INDEX "DataDeletionRequest_pageId_createdAt_idx" ON "DataDeletionRequest"("pageId", "createdAt");
ALTER TABLE "DataDeletionRequest" ADD CONSTRAINT "DataDeletionRequest_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
