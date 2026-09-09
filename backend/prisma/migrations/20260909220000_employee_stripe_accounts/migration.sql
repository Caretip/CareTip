-- Employee Stripe Connect Express (recipient) foundation.
-- Does not change guest Checkout destination, tip fees, or Business payouts.

CREATE TABLE IF NOT EXISTS "employee_stripe_accounts" (
  "id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "stripe_account_id" TEXT NOT NULL,
  "stripe_connect_status" "StripeConnectStatus" NOT NULL DEFAULT 'onboarding_required',
  "stripe_payouts_enabled" BOOLEAN NOT NULL DEFAULT false,
  "stripe_details_submitted" BOOLEAN NOT NULL DEFAULT false,
  "stripe_connect_disabled_reason" VARCHAR(128),
  "stripe_connect_requirements_due" INTEGER NOT NULL DEFAULT 0,
  "stripe_connect_updated_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "employee_stripe_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "employee_stripe_accounts_employee_id_key"
  ON "employee_stripe_accounts"("employee_id");

CREATE UNIQUE INDEX IF NOT EXISTS "employee_stripe_accounts_stripe_account_id_key"
  ON "employee_stripe_accounts"("stripe_account_id");

CREATE INDEX IF NOT EXISTS "employee_stripe_accounts_stripe_connect_status_idx"
  ON "employee_stripe_accounts"("stripe_connect_status");

ALTER TABLE "employee_stripe_accounts"
  ADD CONSTRAINT "employee_stripe_accounts_employee_id_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "employees"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
