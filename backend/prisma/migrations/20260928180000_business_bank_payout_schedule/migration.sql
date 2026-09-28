-- CreateEnum
CREATE TYPE "BusinessBankPayoutSchedule" AS ENUM ('daily', 'every_3_days', 'weekly', 'monthly', 'manual');

-- CreateEnum
CREATE TYPE "StripeConnectScheduledPayoutRequestStatus" AS ENUM ('pending', 'submitted', 'skipped_zero_balance', 'failed');

-- AlterTable
ALTER TABLE "businesses" ADD COLUMN "bank_payout_schedule" "BusinessBankPayoutSchedule" NOT NULL DEFAULT 'daily';
ALTER TABLE "businesses" ADD COLUMN "bank_payout_next_scheduled_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "stripe_connect_scheduled_payout_requests" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "schedule_window_key" VARCHAR(64) NOT NULL,
    "idempotency_key" VARCHAR(160) NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" VARCHAR(8) NOT NULL,
    "stripe_payout_id" VARCHAR(128),
    "status" "StripeConnectScheduledPayoutRequestStatus" NOT NULL,
    "failure_code" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stripe_connect_scheduled_payout_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stripe_connect_scheduled_payout_requests_idempotency_key_key" ON "stripe_connect_scheduled_payout_requests"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "stripe_connect_scheduled_payout_requests_business_id_schedule_window_key_key" ON "stripe_connect_scheduled_payout_requests"("business_id", "schedule_window_key");

-- CreateIndex
CREATE INDEX "stripe_connect_scheduled_payout_requests_business_id_created_at_idx" ON "stripe_connect_scheduled_payout_requests"("business_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "stripe_connect_scheduled_payout_requests_stripe_payout_id_idx" ON "stripe_connect_scheduled_payout_requests"("stripe_payout_id");

-- AddForeignKey
ALTER TABLE "stripe_connect_scheduled_payout_requests" ADD CONSTRAINT "stripe_connect_scheduled_payout_requests_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
