-- Stripe Connect Phase 4: payout balance-transaction reconciliation status + resumable pagination.
-- Additive only. Does not alter tips.payout_status. Does not delete existing payout rows.

CREATE TYPE "StripeConnectPayoutReconciliationStatus" AS ENUM (
  'pending',
  'in_progress',
  'complete',
  'partial',
  'failed'
);

ALTER TABLE "stripe_connect_payouts"
  ADD COLUMN "reconciliation_status" "StripeConnectPayoutReconciliationStatus" NOT NULL DEFAULT 'pending',
  ADD COLUMN "reconciliation_cursor" VARCHAR(128),
  ADD COLUMN "reconciliation_has_more" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "reconciliation_attempt_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "reconciliation_last_error" VARCHAR(255),
  ADD COLUMN "reconciliation_last_attempt_at" TIMESTAMP(3),
  ADD COLUMN "reconciliation_completed_at" TIMESTAMP(3);

CREATE INDEX "stripe_connect_payouts_status_stripe_created_at_idx"
  ON "stripe_connect_payouts"("status", "stripe_created_at" DESC);

CREATE INDEX "stripe_connect_payouts_reconciliation_status_reconciliation_last_attempt_at_idx"
  ON "stripe_connect_payouts"("reconciliation_status", "reconciliation_last_attempt_at");
