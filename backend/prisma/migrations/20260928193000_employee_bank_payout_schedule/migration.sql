-- Employee Connect bank payout schedule (mirror business cadence on employee_stripe_accounts).

ALTER TABLE "employee_stripe_accounts"
  ADD COLUMN "bank_payout_schedule" "BusinessBankPayoutSchedule" NOT NULL DEFAULT 'daily',
  ADD COLUMN "bank_payout_next_scheduled_at" TIMESTAMP(3);

CREATE INDEX "employee_stripe_accounts_bank_payout_schedule_bank_payout_next__idx"
  ON "employee_stripe_accounts" ("bank_payout_schedule", "bank_payout_next_scheduled_at");

CREATE TABLE "employee_stripe_scheduled_payout_requests" (
  "id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "schedule_window_key" VARCHAR(64) NOT NULL,
  "idempotency_key" VARCHAR(160) NOT NULL,
  "amount_cents" INTEGER NOT NULL,
  "currency" VARCHAR(8) NOT NULL,
  "stripe_payout_id" VARCHAR(128),
  "status" "StripeConnectScheduledPayoutRequestStatus" NOT NULL,
  "failure_code" VARCHAR(64),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "employee_stripe_scheduled_payout_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "employee_stripe_scheduled_payout_requests_idempotency_key_key"
  ON "employee_stripe_scheduled_payout_requests" ("idempotency_key");

CREATE UNIQUE INDEX "employee_stripe_scheduled_payout_requests_employee_id_schedule_w_key"
  ON "employee_stripe_scheduled_payout_requests" ("employee_id", "schedule_window_key");

CREATE INDEX "employee_stripe_scheduled_payout_requests_employee_id_created_at_idx"
  ON "employee_stripe_scheduled_payout_requests" ("employee_id", "created_at" DESC);

CREATE INDEX "employee_stripe_scheduled_payout_requests_stripe_payout_id_idx"
  ON "employee_stripe_scheduled_payout_requests" ("stripe_payout_id");

ALTER TABLE "employee_stripe_scheduled_payout_requests"
  ADD CONSTRAINT "employee_stripe_scheduled_payout_requests_employee_id_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "employee_stripe_accounts" ("employee_id")
  ON DELETE CASCADE ON UPDATE CASCADE;
