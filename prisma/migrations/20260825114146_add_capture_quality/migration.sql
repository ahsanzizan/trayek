-- AlterTable
ALTER TABLE "PodSubmission" ADD COLUMN     "lowestQualityScore" INTEGER,
ADD COLUMN     "qualityOverridden" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PodSubmissionPage" ADD COLUMN     "qualityChecks" JSONB,
ADD COLUMN     "qualityOverridden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "qualityScore" INTEGER;
