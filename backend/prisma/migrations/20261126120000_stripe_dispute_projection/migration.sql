-- Additive: Stripe dispute projection + recovery attempts. No existing table is changed.

CREATE TYPE "StripeDisputeSubjectKind" AS ENUM ('tip_destination_business', 'tip_destination_employee', 'tip_platform_hold', 'physical_qr_order', 'subscription', 'unattributed');

CREATE TYPE "StripeDisputeInvestigationStatus" AS ENUM ('new', 'investigating', 'evidence_in_preparation', 'awaiting_stripe_decision', 'closed');

CREATE TYPE "StripeDisputeRecoveryStatus" AS ENUM ('not_applicable', 'not_required', 'review_required', 'in_progress', 'outstanding', 'recovered', 'partially_recovered', 'failed', 'cancelled');

CREATE TYPE "StripeDisputeRecoveryAttemptStatus" AS ENUM ('pending', 'succeeded', 'failed', 'unknown');

CREATE TABLE "stripe_disputes" (
    "id" TEXT NOT NULL,
    "stripe_dispute_id" TEXT NOT NULL,
    "livemode" BOOLEAN NOT NULL DEFAULT false,
    "stripe_status" VARCHAR(40) NOT NULL,
    "stripe_reason" VARCHAR(64),
    "amount_cents" INTEGER NOT NULL,
    "currency" VARCHAR(8) NOT NULL,
    "stripe_charge_id" TEXT,
    "stripe_payment_intent_id" TEXT,
    "stripe_event_account_id" TEXT,
    "charge_amount_cents" INTEGER,
    "charge_amount_refunded_cents" INTEGER,
    "is_charge_refundable" BOOLEAN,
    "destination_account_id" TEXT,
    "destination_transfer_id" TEXT,
    "application_fee_cents" INTEGER,
    "evidence_due_by" TIMESTAMP(3),
    "evidence_has_evidence" BOOLEAN NOT NULL DEFAULT false,
    "evidence_past_due" BOOLEAN NOT NULL DEFAULT false,
    "evidence_submission_count" INTEGER NOT NULL DEFAULT 0,
    "funds_withdrawn_cents" INTEGER NOT NULL DEFAULT 0,
    "funds_reinstated_cents" INTEGER NOT NULL DEFAULT 0,
    "dispute_fee_cents" INTEGER NOT NULL DEFAULT 0,
    "balance_transaction_count" INTEGER NOT NULL DEFAULT 0,
    "stripe_created_at" TIMESTAMP(3) NOT NULL,
    "last_stripe_sync_at" TIMESTAMP(3) NOT NULL,
    "last_stripe_event_id" TEXT,
    "last_stripe_event_type" VARCHAR(64),
    "last_sync_error" VARCHAR(300),
    "last_sync_error_at" TIMESTAMP(3),
    "subject_kind" "StripeDisputeSubjectKind" NOT NULL DEFAULT 'unattributed',
    "business_id" TEXT,
    "employee_id" TEXT,
    "transaction_id" TEXT,
    "physical_qr_order_id" TEXT,
    "subscription_id" TEXT,
    "investigation_status" "StripeDisputeInvestigationStatus" NOT NULL DEFAULT 'new',
    "internal_notes" TEXT,
    "assigned_to_user_id" TEXT,
    "evidence_draft" JSONB,
    "evidence_draft_updated_at" TIMESTAMP(3),
    "evidence_draft_updated_by" TEXT,
    "evidence_submitted_at" TIMESTAMP(3),
    "evidence_submitted_by" TEXT,
    "evidence_last_error" VARCHAR(300),
    "evidence_last_error_at" TIMESTAMP(3),
    "evidence_verified_at" TIMESTAMP(3),
    "evidence_verification_mismatch" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "recovery_status" "StripeDisputeRecoveryStatus" NOT NULL DEFAULT 'not_applicable',
    "recovered_cents" INTEGER NOT NULL DEFAULT 0,
    "recovery_note" VARCHAR(300),
    "recovery_claimed_at" TIMESTAMP(3),
    "recovery_approved_cents" INTEGER,
    "recovery_approved_by" TEXT,
    "recovery_approved_at" TIMESTAMP(3),
    "recovery_policy_version" VARCHAR(40),
    "recovery_transfer_id" TEXT,
    "recovery_connected_account_id" TEXT,
    "recovery_next_retry_at" TIMESTAMP(3),
    "recovery_retry_count" INTEGER NOT NULL DEFAULT 0,
    "recovery_last_failure_code" VARCHAR(64),
    "recovery_last_failure_at" TIMESTAMP(3),
    "recovery_cancelled_at" TIMESTAMP(3),
    "recovery_cancel_reason" VARCHAR(200),
    "notified_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stripe_disputes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stripe_dispute_recovery_attempts" (
    "id" TEXT NOT NULL,
    "dispute_id" TEXT NOT NULL,
    "stripe_transfer_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "idempotency_key" VARCHAR(191) NOT NULL,
    "status" "StripeDisputeRecoveryAttemptStatus" NOT NULL DEFAULT 'pending',
    "stripe_reversal_id" TEXT,
    "error_code" VARCHAR(64),
    "error_message" VARCHAR(300),
    "requested_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "trigger" VARCHAR(20) NOT NULL DEFAULT 'admin',
    "method" VARCHAR(32) NOT NULL DEFAULT 'transfer_reversal',
    "connected_available_cents" INTEGER,
    "transfer_reversed_before_cents" INTEGER,
    "stripe_request_id" VARCHAR(64),

    CONSTRAINT "stripe_dispute_recovery_attempts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stripe_disputes_stripe_dispute_id_key" ON "stripe_disputes"("stripe_dispute_id");

CREATE INDEX "stripe_disputes_stripe_status_idx" ON "stripe_disputes"("stripe_status");

CREATE INDEX "stripe_disputes_evidence_due_by_idx" ON "stripe_disputes"("evidence_due_by");

CREATE INDEX "stripe_disputes_business_id_stripe_created_at_idx" ON "stripe_disputes"("business_id", "stripe_created_at" DESC);

CREATE INDEX "stripe_disputes_recovery_status_idx" ON "stripe_disputes"("recovery_status");

CREATE INDEX "stripe_disputes_recovery_next_retry_at_idx" ON "stripe_disputes"("recovery_next_retry_at");

CREATE INDEX "stripe_disputes_stripe_charge_id_idx" ON "stripe_disputes"("stripe_charge_id");

CREATE INDEX "stripe_disputes_stripe_payment_intent_id_idx" ON "stripe_disputes"("stripe_payment_intent_id");

CREATE UNIQUE INDEX "stripe_dispute_recovery_attempts_idempotency_key_key" ON "stripe_dispute_recovery_attempts"("idempotency_key");

CREATE UNIQUE INDEX "stripe_dispute_recovery_attempts_stripe_reversal_id_key" ON "stripe_dispute_recovery_attempts"("stripe_reversal_id");

CREATE INDEX "stripe_dispute_recovery_attempts_dispute_id_created_at_idx" ON "stripe_dispute_recovery_attempts"("dispute_id", "created_at");

CREATE INDEX "stripe_dispute_recovery_attempts_status_idx" ON "stripe_dispute_recovery_attempts"("status");

ALTER TABLE "stripe_disputes" ADD CONSTRAINT "stripe_disputes_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stripe_dispute_recovery_attempts" ADD CONSTRAINT "stripe_dispute_recovery_attempts_dispute_id_fkey" FOREIGN KEY ("dispute_id") REFERENCES "stripe_disputes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
