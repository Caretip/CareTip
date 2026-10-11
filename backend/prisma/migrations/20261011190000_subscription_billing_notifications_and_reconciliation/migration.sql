-- Sprint 2 — SUB-004 payment-failure notifications + SUB-008 reconciliation drift tracking.
-- Rollback: see rollback.sql (drops tables/enums; not applied to production from this sprint).

CREATE TYPE "SubscriptionBillingNotificationType" AS ENUM ('invoice_payment_failed');

CREATE TYPE "SubscriptionBillingNotificationStatus" AS ENUM (
  'pending',
  'sending',
  'delivered',
  'failed',
  'superseded',
  'skipped_no_recipient'
);

CREATE TABLE "subscription_billing_notifications" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "subscription_id" TEXT,
  "notification_type" "SubscriptionBillingNotificationType" NOT NULL,
  "stripe_invoice_id" TEXT NOT NULL,
  "stripe_event_id" TEXT,
  "stripe_subscription_id" TEXT,
  "invoice_attempt_count" INTEGER,
  "status" "SubscriptionBillingNotificationStatus" NOT NULL DEFAULT 'pending',
  "last_error" TEXT,
  "delivered_at" TIMESTAMP(3),
  "superseded_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "subscription_billing_notifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "subscription_billing_notifications_stripe_invoice_id_notification_type_key"
  ON "subscription_billing_notifications"("stripe_invoice_id", "notification_type");
CREATE INDEX "subscription_billing_notifications_business_id_status_idx"
  ON "subscription_billing_notifications"("business_id", "status");
CREATE INDEX "subscription_billing_notifications_status_updated_at_idx"
  ON "subscription_billing_notifications"("status", "updated_at");

ALTER TABLE "subscription_billing_notifications"
  ADD CONSTRAINT "subscription_billing_notifications_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "subscription_billing_notifications"
  ADD CONSTRAINT "subscription_billing_notifications_subscription_id_fkey"
  FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TYPE "SubscriptionBillingDriftKind" AS ENUM (
  'missing_stripe_subscription',
  'missing_mirror',
  'mirror_drift',
  'status_mismatch',
  'tier_mismatch',
  'orphaned_stripe_subscription',
  'missing_business',
  'ambiguous_mapping',
  'stripe_customer_list_failed'
);

CREATE TYPE "SubscriptionBillingDriftStatus" AS ENUM ('open', 'auto_repaired', 'suppressed');

CREATE TABLE "subscription_billing_reconciliation_runs" (
  "id" TEXT NOT NULL,
  "started_at" TIMESTAMP(3) NOT NULL,
  "finished_at" TIMESTAMP(3),
  "examined" INTEGER NOT NULL DEFAULT 0,
  "matched" INTEGER NOT NULL DEFAULT 0,
  "repaired" INTEGER NOT NULL DEFAULT 0,
  "skipped" INTEGER NOT NULL DEFAULT 0,
  "failed" INTEGER NOT NULL DEFAULT 0,
  "incidents_opened" INTEGER NOT NULL DEFAULT 0,
  "summary" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "subscription_billing_reconciliation_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "subscription_billing_drift_findings" (
  "id" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "run_id" TEXT NOT NULL,
  "kind" "SubscriptionBillingDriftKind" NOT NULL,
  "status" "SubscriptionBillingDriftStatus" NOT NULL DEFAULT 'open',
  "business_id" TEXT,
  "stripe_customer_id" TEXT,
  "stripe_subscription_id" TEXT,
  "mirror_subscription_id" TEXT,
  "details" JSONB,
  "first_seen_at" TIMESTAMP(3) NOT NULL,
  "last_seen_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "subscription_billing_drift_findings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "subscription_billing_drift_findings_fingerprint_key"
  ON "subscription_billing_drift_findings"("fingerprint");
CREATE INDEX "subscription_billing_drift_findings_status_kind_idx"
  ON "subscription_billing_drift_findings"("status", "kind");
CREATE INDEX "subscription_billing_drift_findings_business_id_idx"
  ON "subscription_billing_drift_findings"("business_id");

ALTER TABLE "subscription_billing_drift_findings"
  ADD CONSTRAINT "subscription_billing_drift_findings_run_id_fkey"
  FOREIGN KEY ("run_id") REFERENCES "subscription_billing_reconciliation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
