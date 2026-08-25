-- CreateTable
CREATE TABLE "Shipper" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "npwp" TEXT,
    "financeContactName" TEXT,
    "financeContactEmail" TEXT,
    "financeContactPhone" TEXT,
    "address" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shipper_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequirementProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "shipperId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "rules" JSONB NOT NULL,
    "changeNote" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "RequirementProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Shipper_organizationId_idx" ON "Shipper"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Shipper_organizationId_name_key" ON "Shipper"("organizationId", "name");

-- CreateIndex
CREATE INDEX "RequirementProfile_organizationId_shipperId_idx" ON "RequirementProfile"("organizationId", "shipperId");

-- CreateIndex
CREATE UNIQUE INDEX "RequirementProfile_shipperId_version_key" ON "RequirementProfile"("shipperId", "version");

-- AddForeignKey
ALTER TABLE "Shipper" ADD CONSTRAINT "Shipper_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementProfile" ADD CONSTRAINT "RequirementProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementProfile" ADD CONSTRAINT "RequirementProfile_shipperId_fkey" FOREIGN KEY ("shipperId") REFERENCES "Shipper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- At most one active (not superseded) profile version per shipper. Prisma
-- cannot express a partial unique index, and an application-level check would
-- lose a race between two admins publishing a new version at once.
CREATE UNIQUE INDEX "RequirementProfile_one_active_per_shipper"
    ON "RequirementProfile" ("shipperId")
    WHERE "supersededAt" IS NULL;

-- TRK-010: "A profile version referenced by any packet cannot be edited, only
-- superseded." Enforced in the database rather than in a resolver, because the
-- guarantee is what makes a packet re-explainable years later: reading version
-- 3 must show what version 3 actually required at assembly time.
--
-- Superseding is the one permitted UPDATE, and only once — a supersededAt that
-- can be cleared would make "active" editable by the back door.
CREATE OR REPLACE FUNCTION requirement_profile_immutable() RETURNS TRIGGER AS $$
BEGIN
    IF NEW."id" IS DISTINCT FROM OLD."id"
        OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
        OR NEW."shipperId" IS DISTINCT FROM OLD."shipperId"
        OR NEW."version" IS DISTINCT FROM OLD."version"
        OR NEW."rules" IS DISTINCT FROM OLD."rules"
        OR NEW."changeNote" IS DISTINCT FROM OLD."changeNote"
        OR NEW."createdById" IS DISTINCT FROM OLD."createdById"
        OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    THEN
        RAISE EXCEPTION 'RequirementProfile is immutable: create a new version instead of editing version %', OLD."version"
            USING ERRCODE = 'restrict_violation';
    END IF;

    IF OLD."supersededAt" IS NOT NULL
        AND NEW."supersededAt" IS DISTINCT FROM OLD."supersededAt"
    THEN
        RAISE EXCEPTION 'RequirementProfile version % is already superseded', OLD."version"
            USING ERRCODE = 'restrict_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER requirement_profile_no_edit
    BEFORE UPDATE ON "RequirementProfile"
    FOR EACH ROW EXECUTE FUNCTION requirement_profile_immutable();
