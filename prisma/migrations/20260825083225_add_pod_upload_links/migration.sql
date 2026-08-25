-- CreateTable
CREATE TABLE "PodUploadLink" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "useBudget" INTEGER NOT NULL,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PodUploadLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PodUploadThrottle" (
    "bucket" TEXT NOT NULL,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PodUploadThrottle_pkey" PRIMARY KEY ("bucket")
);

-- CreateIndex
CREATE UNIQUE INDEX "PodUploadLink_tokenHash_key" ON "PodUploadLink"("tokenHash");

-- CreateIndex
CREATE INDEX "PodUploadLink_organizationId_orderId_idx" ON "PodUploadLink"("organizationId", "orderId");

-- CreateIndex
CREATE INDEX "PodUploadLink_organizationId_expiresAt_idx" ON "PodUploadLink"("organizationId", "expiresAt");

-- CreateIndex
CREATE INDEX "PodUploadThrottle_windowStartedAt_idx" ON "PodUploadThrottle"("windowStartedAt");

-- AddForeignKey
ALTER TABLE "PodUploadLink" ADD CONSTRAINT "PodUploadLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PodUploadLink" ADD CONSTRAINT "PodUploadLink_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
