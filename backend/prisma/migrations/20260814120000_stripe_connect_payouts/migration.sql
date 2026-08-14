-- Stripe Connect Phase 3: observe connected-account Payout objects.
-- Additive only. Does not alter tips.payout_status (legacy employee flag).
-- Rollback: DROP TABLE stripe_connect_payout_balance_lines; DROP TABLE stripe_connect_payouts; DROP TYPE "StripeConnectPayoutStatus";

CREATE TYPE "StripeConnectPayoutStatus" AS ENUM (
  'pending',
  'in_transit',
  'paid',
  'failed',
  'canceled',
  'unknown'
);

CREATE TABLE "stripe_connect_payouts" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "stripe_account_id" TEXT NOT NULL,
  "stripe_payout_id" TEXT NOT NULL,
  "amount_cents" INTEGER NOT NULL,
  "currency" VARCHAR(8) NOT NULL,
  "status" "StripeConnectPayoutStatus" NOT NULL,
  "arrival_date" TIMESTAMP(3),
  "method" VARCHAR(32),
  "payout_type" VARCHAR(32),
  "description" VARCHAR(255),
  "failure_code" VARCHAR(64),
  "failure_message" VARCHAR(255),
  "stripe_created_at" TIMESTAMP(3) NOT NULL,
  "last_stripe_event_created" INTEGER NOT NULL,
  "last_stripe_event_type" VARCHAR(64) NOT NULL,
  "last_stripe_event_id" VARCHAR(128),
  "paid_at" TIMESTAMP(3),
  "failed_at" TIMESTAMP(3),
  "canceled_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "stripe_connect_payouts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stripe_connect_payouts_stripe_payout_id_key"
  ON "stripe_connect_payouts"("stripe_payout_id");

CREATE INDEX "stripe_connect_payouts_business_id_stripe_created_at_idx"
  ON "stripe_connect_payouts"("business_id", "stripe_created_at" DESC);

CREATE INDEX "stripe_connect_payouts_business_id_status_idx"
  ON "stripe_connect_payouts"("business_id", "status");

CREATE INDEX "stripe_connect_payouts_stripe_account_id_idx"
  ON "stripe_connect_payouts"("stripe_account_id");

ALTER TABLE "stripe_connect_payouts"
  ADD CONSTRAINT "stripe_connect_payouts_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "stripe_connect_payout_balance_lines" (
  "id" TEXT NOT NULL,
  "payout_id" TEXT NOT NULL,
  "stripe_balance_transaction_id" TEXT NOT NULL,
  "reporting_category" VARCHAR(64),
  "type" VARCHAR(64) NOT NULL,
  "amount_cents" INTEGER NOT NULL,
  "fee_cents" INTEGER NOT NULL,
  "net_cents" INTEGER NOT NULL,
  "currency" VARCHAR(8) NOT NULL,
  "created_at_stripe" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "stripe_connect_payout_balance_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stripe_connect_payout_balance_lines_stripe_balance_transaction_id_key"
  ON "stripe_connect_payout_balance_lines"("stripe_balance_transaction_id");

CREATE INDEX "stripe_connect_payout_balance_lines_payout_id_idx"
  ON "stripe_connect_payout_balance_lines"("payout_id");

ALTER TABLE "stripe_connect_payout_balance_lines"
  ADD CONSTRAINT "stripe_connect_payout_balance_lines_payout_id_fkey"
  FOREIGN KEY ("payout_id") REFERENCES "stripe_connect_payouts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
