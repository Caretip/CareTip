-- Tip / Connect / payout Stripe webhook durable processing claims (parity with billing webhooks).

DO $$ BEGIN
  CREATE TYPE "StripeWebhookEventProcessingResult" AS ENUM ('processing', 'processed', 'failed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "stripe_webhook_events"
  ADD COLUMN IF NOT EXISTS "processing_result" "StripeWebhookEventProcessingResult" NOT NULL DEFAULT 'processed',
  ADD COLUMN IF NOT EXISTS "processing_claim_token" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "processing_claim_expires_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "processing_error" VARCHAR(500);

-- Legacy rows were only inserted after successful handler completion.
UPDATE "stripe_webhook_events"
SET "processing_result" = 'processed'
WHERE "processing_result" IS NULL OR "processing_result" = 'processed';

ALTER TABLE "stripe_webhook_events"
  ALTER COLUMN "processed_at" DROP NOT NULL;

CREATE INDEX IF NOT EXISTS "stripe_webhook_events_processing_claim_expires_at_idx"
  ON "stripe_webhook_events" ("processing_claim_expires_at");
