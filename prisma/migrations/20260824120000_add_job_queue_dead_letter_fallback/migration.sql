-- CreateTable
CREATE TABLE "JobExecution" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeadLetterJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "error" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "DeadLetterJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HumanFallbackEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "instruction" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),

    CONSTRAINT "HumanFallbackEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobExecution_organizationId_name_idx" ON "JobExecution"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "JobExecution_organizationId_idempotencyKey_key" ON "JobExecution"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "DeadLetterJob_organizationId_createdAt_idx" ON "DeadLetterJob"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeadLetterJob_organizationId_idempotencyKey_key" ON "DeadLetterJob"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "HumanFallbackEvent_organizationId_acknowledgedAt_idx" ON "HumanFallbackEvent"("organizationId", "acknowledgedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HumanFallbackEvent_organizationId_source_dedupeKey_key" ON "HumanFallbackEvent"("organizationId", "source", "dedupeKey");

-- AddForeignKey
ALTER TABLE "JobExecution" ADD CONSTRAINT "JobExecution_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeadLetterJob" ADD CONSTRAINT "DeadLetterJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HumanFallbackEvent" ADD CONSTRAINT "HumanFallbackEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

