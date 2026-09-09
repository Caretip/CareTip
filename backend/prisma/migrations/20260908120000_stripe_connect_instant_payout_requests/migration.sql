-- Instant Payout create idempotency (does not replace stripe_connect_payouts history).

CREATE TYPE "StripeConnectInstantPayoutRequestStatus" AS ENUM ('pending', 'submitted', 'failed');

CREATE TABLE "stripe_connect_instant_payout_requests" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "idempotency_key" VARCHAR(160) NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" VARCHAR(8) NOT NULL,
    "stripe_payout_id" VARCHAR(128),
    "status" "StripeConnectInstantPayoutRequestStatus" NOT NULL,
    "failure_code" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stripe_connect_instant_payout_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stripe_connect_instant_payout_requests_idempotency_key_key" ON "stripe_connect_instant_payout_requests"("idempotency_key");
CREATE INDEX "stripe_connect_instant_payout_requests_business_id_created_at_idx" ON "stripe_connect_instant_payout_requests"("business_id", "created_at" DESC);

ALTER TABLE "stripe_connect_instant_payout_requests"
  ADD CONSTRAINT "stripe_connect_instant_payout_requests_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
