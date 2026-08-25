-- One idempotency key per capture attempt (TRK-033). A driver on a dropping
-- connection retries, and the retry has to land on the submission the first
-- attempt opened rather than beside it.
--
-- NOT NULL without a default is safe here: no POD submission has been made in
-- any environment yet, and a submission without a key could never be
-- deduplicated, which is the whole point of the column.
ALTER TABLE "PodSubmission" ADD COLUMN "idempotencyKey" TEXT NOT NULL;

-- Scoped by organization rather than globally: the key comes from a client,
-- and one tenant must not be able to collide with another's.
CREATE UNIQUE INDEX "PodSubmission_organizationId_idempotencyKey_key"
    ON "PodSubmission"("organizationId", "idempotencyKey");
