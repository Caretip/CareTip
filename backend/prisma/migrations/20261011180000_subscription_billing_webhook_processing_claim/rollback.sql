-- Rollback processing claim columns only. PostgreSQL cannot drop enum value `processing`
-- without recreating the type; leave `processing` in the enum if rolling back in production.

DROP INDEX IF EXISTS "subscription_events_processing_claim_expires_at_idx";

ALTER TABLE "subscription_events"
  DROP COLUMN IF EXISTS "processing_claim_expires_at",
  DROP COLUMN IF EXISTS "processing_claim_token";
