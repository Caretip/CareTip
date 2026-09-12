-- Employee Stripe → bank payout observations. Distinct from stripe_connect_payouts (business).

CREATE TABLE "employee_stripe_payouts" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "stripe_account_id" TEXT NOT NULL,
    "stripe_payout_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" VARCHAR(8) NOT NULL,
    "status" "StripeConnectPayoutStatus" NOT NULL,
    "arrival_date" TIMESTAMP(3),
    "method" VARCHAR(32),
    "payout_type" VARCHAR(32),
    "application_fee_amount_cents" INTEGER,
    "stripe_application_fee_id" VARCHAR(128),
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

    CONSTRAINT "employee_stripe_payouts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "employee_stripe_payouts_stripe_payout_id_key" ON "employee_stripe_payouts"("stripe_payout_id");
CREATE INDEX "employee_stripe_payouts_employee_id_stripe_created_at_idx" ON "employee_stripe_payouts"("employee_id", "stripe_created_at" DESC);
CREATE INDEX "employee_stripe_payouts_business_id_stripe_created_at_idx" ON "employee_stripe_payouts"("business_id", "stripe_created_at" DESC);
CREATE INDEX "employee_stripe_payouts_stripe_account_id_idx" ON "employee_stripe_payouts"("stripe_account_id");
CREATE INDEX "employee_stripe_payouts_status_stripe_created_at_idx" ON "employee_stripe_payouts"("status", "stripe_created_at" DESC);
CREATE INDEX "employee_stripe_payouts_method_stripe_created_at_idx" ON "employee_stripe_payouts"("method", "stripe_created_at" DESC);

ALTER TABLE "employee_stripe_payouts"
  ADD CONSTRAINT "employee_stripe_payouts_employee_id_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "employee_stripe_payouts"
  ADD CONSTRAINT "employee_stripe_payouts_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
