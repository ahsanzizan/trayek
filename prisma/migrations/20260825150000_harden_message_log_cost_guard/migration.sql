-- Keep the TRK-022 attribution fields immutable while allowing the delivery
-- status transition and the first external identifier write.
CREATE OR REPLACE FUNCTION message_log_append_only() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
        RAISE EXCEPTION 'MessageLog is append-only: % is not permitted', TG_OP
            USING ERRCODE = 'restrict_violation';
    END IF;

    IF OLD."id" IS DISTINCT FROM NEW."id"
       OR OLD."organizationId" IS DISTINCT FROM NEW."organizationId"
       OR OLD."channel" IS DISTINCT FROM NEW."channel"
       OR OLD."direction" IS DISTINCT FROM NEW."direction"
       OR OLD."from" IS DISTINCT FROM NEW."from"
       OR OLD."to" IS DISTINCT FROM NEW."to"
       OR OLD."body" IS DISTINCT FROM NEW."body"
       OR OLD."truncated" IS DISTINCT FROM NEW."truncated"
       OR OLD."category" IS DISTINCT FROM NEW."category"
       OR OLD."estimatedCost" IS DISTINCT FROM NEW."estimatedCost"
       OR OLD."conversationWindowState" IS DISTINCT FROM NEW."conversationWindowState"
       OR OLD."createdAt" IS DISTINCT FROM NEW."createdAt"
       OR OLD."status" <> 'PENDING'::"MessageLogStatus"
       OR NEW."status" NOT IN (
           'SENT'::"MessageLogStatus",
           'FAILED'::"MessageLogStatus"
       )
       OR (
           OLD."externalId" IS NOT NULL
           AND OLD."externalId" IS DISTINCT FROM NEW."externalId"
       )
    THEN
        RAISE EXCEPTION
            'MessageLog is immutable: only PENDING delivery transition is permitted'
            USING ERRCODE = 'restrict_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
