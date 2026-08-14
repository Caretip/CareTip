-- Stripe Connect Phase 1: unique connected account id + capability/status mirror.
-- Does not backfill or create Stripe accounts for existing businesses.

CREATE TYPE "StripeConnectStatus" AS ENUM (
  'not_connected',
  'onboarding_required',
  'onboarding_incomplete',
  'requires_information',
  'ready',
  'restricted'
);

ALTER TABLE "businesses"
  ADD COLUMN IF NOT EXISTS "stripe_connect_status" "StripeConnectStatus" NOT NULL DEFAULT 'not_connected',
  ADD COLUMN IF NOT EXISTS "stripe_charges_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "stripe_payouts_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "stripe_details_submitted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "stripe_connect_disabled_reason" VARCHAR(128),
  ADD COLUMN IF NOT EXISTS "stripe_connect_requirements_due" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "stripe_connect_updated_at" TIMESTAMP(3);

-- Unique Connect account binding (nullable unique: multiple NULLs allowed in PostgreSQL).
CREATE UNIQUE INDEX IF NOT EXISTS "businesses_stripe_account_id_key"
  ON "businesses"("stripe_account_id");
