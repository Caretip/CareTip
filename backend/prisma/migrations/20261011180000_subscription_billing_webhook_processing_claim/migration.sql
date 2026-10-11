-- Sprint 1.2 — durable in-flight claim for Stripe billing webhook deliveries.
-- Rollback: see rollback.sql (enum value `processing` cannot be removed in PostgreSQL).

ALTER TYPE "SubscriptionEventProcessingResult" ADD VALUE IF NOT EXISTS 'processing';

ALTER TABLE "subscription_events"
  ADD COLUMN IF NOT EXISTS "processing_claim_token" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "processing_claim_expires_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "subscription_events_processing_claim_expires_at_idx"
  ON "subscription_events" ("processing_claim_expires_at");
