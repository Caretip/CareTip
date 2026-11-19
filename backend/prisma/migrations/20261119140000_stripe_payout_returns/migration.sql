-- Returned payouts: append-only audit record (additive; no existing table changes).
-- Rollback: DROP TABLE "stripe_payout_returns";

-- CreateTable
CREATE TABLE "stripe_payout_returns" (
    "id" TEXT NOT NULL,
    "payout_kind" VARCHAR(16) NOT NULL,
    "payout_row_id" TEXT NOT NULL,
    "stripe_payout_id" VARCHAR(128) NOT NULL,
    "stripe_account_id" VARCHAR(128) NOT NULL,
    "business_id" TEXT NOT NULL,
    "employee_id" TEXT,
    "amount_cents" INTEGER NOT NULL,
    "currency" VARCHAR(8) NOT NULL,
    "original_paid_at" TIMESTAMP(3),
    "returned_at" TIMESTAMP(3) NOT NULL,
    "failure_code" VARCHAR(64),
    "failure_message" VARCHAR(255),
    "failure_balance_transaction_id" VARCHAR(128),
    "stripe_event_id" VARCHAR(128),
    "detected_via" VARCHAR(32) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stripe_payout_returns_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stripe_payout_returns_stripe_payout_id_key" ON "stripe_payout_returns"("stripe_payout_id");
CREATE INDEX "stripe_payout_returns_business_id_returned_at_idx" ON "stripe_payout_returns"("business_id", "returned_at" DESC);
CREATE INDEX "stripe_payout_returns_employee_id_returned_at_idx" ON "stripe_payout_returns"("employee_id", "returned_at" DESC);
CREATE INDEX "stripe_payout_returns_payout_kind_payout_row_id_idx" ON "stripe_payout_returns"("payout_kind", "payout_row_id");

-- Supabase API roles get no access (same as other tables, see SEC-03); Prisma owns the table.
ALTER TABLE "stripe_payout_returns" ENABLE ROW LEVEL SECURITY;
