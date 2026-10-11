-- Phase A: scheduled bank payout recovery diagnostics (employee + business ledgers).

CREATE TYPE "ScheduledPayoutFailureClassification" AS ENUM (
  'retryable',
  'permanent',
  'outcome_uncertain',
  'account_blocked',
  'unknown'
);

CREATE TYPE "ScheduledPayoutReconciliationStatus" AS ENUM (
  'none',
  'required',
  'in_progress',
  'resolved',
  'inconclusive'
);

ALTER TABLE "stripe_connect_scheduled_payout_requests"
  ADD COLUMN "attempt_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "next_retry_at" TIMESTAMP(3),
  ADD COLUMN "failure_classification" "ScheduledPayoutFailureClassification",
  ADD COLUMN "stripe_error_code" VARCHAR(64),
  ADD COLUMN "stripe_error_type" VARCHAR(64),
  ADD COLUMN "stripe_http_status" INTEGER,
  ADD COLUMN "stripe_request_id" VARCHAR(128),
  ADD COLUMN "failure_message" VARCHAR(255),
  ADD COLUMN "reconciliation_status" "ScheduledPayoutReconciliationStatus" NOT NULL DEFAULT 'none',
  ADD COLUMN "correlation_id" VARCHAR(64),
  ADD COLUMN "blocked_reason" VARCHAR(64),
  ADD COLUMN "processing_claimed_at" TIMESTAMP(3);

ALTER TABLE "employee_stripe_scheduled_payout_requests"
  ADD COLUMN "attempt_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "next_retry_at" TIMESTAMP(3),
  ADD COLUMN "failure_classification" "ScheduledPayoutFailureClassification",
  ADD COLUMN "stripe_error_code" VARCHAR(64),
  ADD COLUMN "stripe_error_type" VARCHAR(64),
  ADD COLUMN "stripe_http_status" INTEGER,
  ADD COLUMN "stripe_request_id" VARCHAR(128),
  ADD COLUMN "failure_message" VARCHAR(255),
  ADD COLUMN "reconciliation_status" "ScheduledPayoutReconciliationStatus" NOT NULL DEFAULT 'none',
  ADD COLUMN "correlation_id" VARCHAR(64),
  ADD COLUMN "blocked_reason" VARCHAR(64),
  ADD COLUMN "processing_claimed_at" TIMESTAMP(3);

CREATE INDEX "stripe_connect_scheduled_payout_requests_retry_idx"
  ON "stripe_connect_scheduled_payout_requests" ("next_retry_at", "status");

CREATE INDEX "employee_stripe_scheduled_payout_requests_retry_idx"
  ON "employee_stripe_scheduled_payout_requests" ("next_retry_at", "status");
