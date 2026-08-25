-- CreateTable
CREATE TABLE "PodSubmission" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "podUploadLinkId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PodSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PodSubmissionPage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "podSubmissionId" TEXT NOT NULL,
    "pageIndex" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PodSubmissionPage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PodSubmission_organizationId_orderId_idx" ON "PodSubmission"("organizationId", "orderId");

-- CreateIndex
CREATE INDEX "PodSubmission_organizationId_receivedAt_idx" ON "PodSubmission"("organizationId", "receivedAt");

-- CreateIndex
CREATE INDEX "PodSubmissionPage_organizationId_podSubmissionId_idx" ON "PodSubmissionPage"("organizationId", "podSubmissionId");

-- CreateIndex
CREATE UNIQUE INDEX "PodSubmissionPage_podSubmissionId_pageIndex_key" ON "PodSubmissionPage"("podSubmissionId", "pageIndex");

-- AddForeignKey
ALTER TABLE "PodSubmission" ADD CONSTRAINT "PodSubmission_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PodSubmission" ADD CONSTRAINT "PodSubmission_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PodSubmission" ADD CONSTRAINT "PodSubmission_podUploadLinkId_fkey" FOREIGN KEY ("podUploadLinkId") REFERENCES "PodUploadLink"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PodSubmissionPage" ADD CONSTRAINT "PodSubmissionPage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PodSubmissionPage" ADD CONSTRAINT "PodSubmissionPage_podSubmissionId_fkey" FOREIGN KEY ("podSubmissionId") REFERENCES "PodSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
