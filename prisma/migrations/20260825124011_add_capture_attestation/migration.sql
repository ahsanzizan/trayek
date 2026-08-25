-- CreateEnum
CREATE TYPE "GeolocationPermission" AS ENUM ('GRANTED', 'DENIED', 'UNAVAILABLE');

-- AlterTable
ALTER TABLE "PodSubmission" ADD COLUMN     "captureAccuracyMeters" DOUBLE PRECISION,
ADD COLUMN     "captureLatitude" DOUBLE PRECISION,
ADD COLUMN     "captureLongitude" DOUBLE PRECISION,
ADD COLUMN     "capturedAt" TIMESTAMP(3),
ADD COLUMN     "geolocationPermission" "GeolocationPermission";
