-- Persist Stripe payout application-fee fields (nullable; no fabricated historical fees).
ALTER TABLE "stripe_connect_payouts"
  ADD COLUMN IF NOT EXISTS "application_fee_amount_cents" INTEGER,
  ADD COLUMN IF NOT EXISTS "stripe_application_fee_id" VARCHAR(128);

-- Admin list filter by Instant vs Standard.
CREATE INDEX IF NOT EXISTS "stripe_connect_payouts_method_stripe_created_at_idx"
  ON "stripe_connect_payouts" ("method", "stripe_created_at" DESC);

-- Join Instant request ledger → payout for evidence-based method backfill / admin detail.
CREATE INDEX IF NOT EXISTS "stripe_connect_instant_payout_requests_stripe_payout_id_idx"
  ON "stripe_connect_instant_payout_requests" ("stripe_payout_id");

-- Evidence-based backfill only: CareTip Instant create ledger. Do not label remaining rows Standard.
UPDATE "stripe_connect_payouts" p
SET "method" = 'instant'
FROM "stripe_connect_instant_payout_requests" r
WHERE r.stripe_payout_id IS NOT NULL
  AND r.stripe_payout_id = p.stripe_payout_id
  AND r.status = 'submitted'
  AND (p.method IS NULL OR btrim(p.method) = '');
