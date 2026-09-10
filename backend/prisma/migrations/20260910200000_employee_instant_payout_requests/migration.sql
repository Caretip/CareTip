-- Employee Instant Payout idempotency (not business stripe_connect_payouts).

CREATE TABLE "employee_instant_payout_requests" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "idempotency_key" VARCHAR(160) NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" VARCHAR(8) NOT NULL,
    "stripe_payout_id" VARCHAR(128),
    "status" "StripeConnectInstantPayoutRequestStatus" NOT NULL,
    "failure_code" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_instant_payout_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "employee_instant_payout_requests_idempotency_key_key" ON "employee_instant_payout_requests"("idempotency_key");
CREATE INDEX "employee_instant_payout_requests_employee_id_created_at_idx" ON "employee_instant_payout_requests"("employee_id", "created_at" DESC);
CREATE INDEX "employee_instant_payout_requests_stripe_payout_id_idx" ON "employee_instant_payout_requests"("stripe_payout_id");

ALTER TABLE "employee_instant_payout_requests"
  ADD CONSTRAINT "employee_instant_payout_requests_employee_id_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
