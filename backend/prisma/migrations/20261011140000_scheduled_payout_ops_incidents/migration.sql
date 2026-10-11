-- Phase C: scheduled bank payout operational incidents (platform-admin notifications).
-- NOT applied by automation — deploy only after review.

CREATE TYPE "ScheduledPayoutOpsIncidentPayoutType" AS ENUM ('employee', 'business');

CREATE TYPE "ScheduledPayoutOpsIncidentCategory" AS ENUM (
  'retry_exhausted',
  'reconciliation_required',
  'reconciliation_inconclusive',
  'outcome_uncertain',
  'stale_pending_blocked',
  'manual_intervention_required',
  'payout_overdue'
);

CREATE TYPE "ScheduledPayoutOpsIncidentStatus" AS ENUM ('open', 'resolved');

CREATE TABLE "scheduled_payout_ops_incidents" (
  "id" TEXT NOT NULL,
  "payout_type" "ScheduledPayoutOpsIncidentPayoutType" NOT NULL,
  "ledger_id" VARCHAR(64) NOT NULL,
  "category" "ScheduledPayoutOpsIncidentCategory" NOT NULL,
  "status" "ScheduledPayoutOpsIncidentStatus" NOT NULL DEFAULT 'open',
  "severity" "NotificationPriority" NOT NULL DEFAULT 'normal',
  "state_fingerprint" VARCHAR(64) NOT NULL,
  "resolved_fingerprint" VARCHAR(64),
  "schedule_window_key" VARCHAR(64),
  "subject_label" VARCHAR(128),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "notify_generation" INTEGER NOT NULL DEFAULT 1,
  "last_notified_generation" INTEGER NOT NULL DEFAULT 0,
  "notifying_generation" INTEGER,
  "first_detected_at" TIMESTAMP(3) NOT NULL,
  "last_observed_at" TIMESTAMP(3) NOT NULL,
  "resolved_at" TIMESTAMP(3),
  "last_notified_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "scheduled_payout_ops_incidents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "scheduled_payout_ops_incidents_unique"
  ON "scheduled_payout_ops_incidents" ("payout_type", "ledger_id", "category");

CREATE INDEX "scheduled_payout_ops_incidents_status_observed_idx"
  ON "scheduled_payout_ops_incidents" ("status", "last_observed_at" DESC);
