-- CreateEnum
CREATE TYPE "DsoBaselineMethod" AS ENUM ('CLAIMED', 'COMPUTED_FROM_INVOICES', 'COMPUTED_FROM_BALANCES');

-- CreateTable
CREATE TABLE "DsoBaseline" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "method" "DsoBaselineMethod" NOT NULL,
    "dsoDays" INTEGER NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "invoicedRevenue" BIGINT,
    "averageReceivable" BIGINT,
    "invoiceCount" INTEGER,
    "statedUnprompted" BOOLEAN,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DsoBaseline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistoricalInvoice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "nomorInvoice" TEXT NOT NULL,
    "shipperName" TEXT,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "paymentDate" TIMESTAMP(3),
    "amountRupiah" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HistoricalInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DsoBaseline_organizationId_idx" ON "DsoBaseline"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "DsoBaseline_organizationId_method_key" ON "DsoBaseline"("organizationId", "method");

-- CreateIndex
CREATE INDEX "HistoricalInvoice_organizationId_issueDate_idx" ON "HistoricalInvoice"("organizationId", "issueDate");

-- CreateIndex
CREATE UNIQUE INDEX "HistoricalInvoice_organizationId_nomorInvoice_key" ON "HistoricalInvoice"("organizationId", "nomorInvoice");

-- AddForeignKey
ALTER TABLE "DsoBaseline" ADD CONSTRAINT "DsoBaseline_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricalInvoice" ADD CONSTRAINT "HistoricalInvoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- TRK-013: "Baseline snapshot cannot be edited after the first packet is
-- created for that org."
--
-- Enforced as: never editable at all. The criterion names packets, which
-- arrive in TRK-080, but a baseline is a measurement frozen at a point in
-- time — there is no legitimate edit either before or after a packet exists.
-- Correcting one means recording a new measurement, the same way a correction
-- to an approved invoice is a new document (INV-7).
--
-- Deletion stays permitted so an organization can still be removed; the
-- criterion is about editing, and no procedure deletes a baseline.
CREATE OR REPLACE FUNCTION dso_baseline_immutable() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'DsoBaseline is immutable: record a new measurement instead of editing the % baseline', OLD."method"
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER dso_baseline_no_edit
    BEFORE UPDATE ON "DsoBaseline"
    FOR EACH ROW EXECUTE FUNCTION dso_baseline_immutable();
