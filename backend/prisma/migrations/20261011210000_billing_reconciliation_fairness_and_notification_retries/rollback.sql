DROP INDEX IF EXISTS "businesses_stripe_customer_reconciliation_idx";
DROP INDEX IF EXISTS "subscription_billing_notifications_status_next_attempt_at_idx";
ALTER TABLE "subscription_billing_notifications"
  DROP COLUMN IF EXISTS "next_attempt_at",
  DROP COLUMN IF EXISTS "last_attempt_at",
  DROP COLUMN IF EXISTS "send_attempt_count";
DROP TABLE IF EXISTS "subscription_billing_reconciliation_cursors";
-- enum value `exhausted` cannot be removed in PostgreSQL without recreation.
