-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('CREATED', 'IN_TRANSIT', 'DELIVERED', 'POD_RECEIVED', 'POD_VALIDATED', 'PACKET_READY', 'INVOICED', 'PAID', 'REJECTED');

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "nomorOrder" TEXT NOT NULL,
    "nomorSuratJalan" TEXT NOT NULL,
    "shipperId" TEXT NOT NULL,
    "driverId" TEXT,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "plannedDeliveryDate" TIMESTAMP(3),
    "actualDeliveryDate" TIMESTAMP(3),
    "jumlahKoli" INTEGER,
    "weightGram" INTEGER,
    "nilaiTagihan" BIGINT,
    "status" "OrderStatus" NOT NULL DEFAULT 'CREATED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Order_organizationId_status_idx" ON "Order"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Order_organizationId_shipperId_idx" ON "Order"("organizationId", "shipperId");

-- CreateIndex
CREATE INDEX "Order_organizationId_driverId_idx" ON "Order"("organizationId", "driverId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_organizationId_nomorSuratJalan_key" ON "Order"("organizationId", "nomorSuratJalan");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_shipperId_fkey" FOREIGN KEY ("shipperId") REFERENCES "Shipper"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;
