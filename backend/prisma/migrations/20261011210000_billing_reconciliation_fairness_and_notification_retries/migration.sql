-- Fair reconciliation cursor + bounded notification send retries (SUB-004 / SUB-008).

CREATE TABLE "subscription_billing_reconciliation_cursors" (
  "stream" VARCHAR(32) NOT NULL,
  "anchor_created_at" TIMESTAMP(3) NOT NULL,
  "anchor_business_id" VARCHAR(64) NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "subscription_billing_reconciliation_cursors_pkey" PRIMARY KEY ("stream")
);

ALTER TYPE "SubscriptionBillingNotificationStatus" ADD VALUE IF NOT EXISTS 'exhausted';

ALTER TABLE "subscription_billing_notifications"
  ADD COLUMN IF NOT EXISTS "send_attempt_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "last_attempt_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "next_attempt_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "subscription_billing_notifications_status_next_attempt_at_idx"
  ON "subscription_billing_notifications" ("status", "next_attempt_at");

CREATE INDEX IF NOT EXISTS "businesses_stripe_customer_reconciliation_idx"
  ON "businesses" ("created_at", "id")
  WHERE "stripe_customer_id" IS NOT NULL;
