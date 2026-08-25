-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('WHATSAPP_BAILEYS', 'EMAIL');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "MessageLogStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "ChannelConnectionStatus" AS ENUM ('CONNECTED', 'DISCONNECTED', 'NEEDS_PAIRING');

-- CreateTable
CREATE TABLE "MessageLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "channel" "ChannelType" NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "body" TEXT,
    "status" "MessageLogStatus" NOT NULL DEFAULT 'PENDING',
    "externalId" TEXT,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelConnection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "channel" "ChannelType" NOT NULL,
    "status" "ChannelConnectionStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "authState" JSONB,
    "authStateVersion" INTEGER NOT NULL DEFAULT 1,
    "lastConnectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MessageLog_organizationId_idx" ON "MessageLog"("organizationId");

-- CreateIndex
CREATE INDEX "MessageLog_organizationId_createdAt_idx" ON "MessageLog"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "MessageLog_organizationId_channel_createdAt_idx" ON "MessageLog"("organizationId", "channel", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MessageLog_organizationId_externalId_key" ON "MessageLog"("organizationId", "externalId");

-- CreateIndex
CREATE INDEX "ChannelConnection_organizationId_idx" ON "ChannelConnection"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelConnection_organizationId_channel_key" ON "ChannelConnection"("organizationId", "channel");

-- AddForeignKey
ALTER TABLE "MessageLog" ADD CONSTRAINT "MessageLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelConnection" ADD CONSTRAINT "ChannelConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
