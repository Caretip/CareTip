-- GDPR lifecycle Slice C — expand only (additive).
-- No FK contract changes. No data destruction.
-- Rollback: DROP new columns/tables/enums (see Phase 2 rollback notes).

-- Enums
CREATE TYPE "AccountStatus" AS ENUM ('active', 'deactivated', 'erasure_pending', 'anonymized', 'closed');
CREATE TYPE "BusinessLifecycle" AS ENUM ('active', 'soft_closed', 'data_restricted', 'tombstoned');
CREATE TYPE "DataLifecycleJobType" AS ENUM (
  'erasure_continue',
  'anonymize_user',
  'anonymize_employee',
  'kyc_secure_destroy',
  'analytics_ttl',
  'audit_scrub',
  'storage_orphan_gc',
  'support_redact',
  'dsar_export'
);
CREATE TYPE "DataLifecycleJobStatus" AS ENUM (
  'pending',
  'running',
  'succeeded',
  'failed',
  'skipped_legal_hold',
  'cancelled'
);

-- User lifecycle columns
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "account_status" "AccountStatus" NOT NULL DEFAULT 'active';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "deletion_requested_at" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "deletion_cancel_until" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "anonymized_at" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "closed_at" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "next_lifecycle_wake_at" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "legal_hold" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "legal_hold_reason" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "legal_hold_categories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "legal_hold_set_at" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "email_hash" TEXT;

CREATE INDEX IF NOT EXISTS "User_account_status_idx" ON "User"("account_status");

-- Business lifecycle columns
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "lifecycle_status" "BusinessLifecycle" NOT NULL DEFAULT 'active';
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "anonymized_at" TIMESTAMP(3);
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "kyc_retain_until" TIMESTAMP(3);
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "financial_retain_until" TIMESTAMP(3);
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "legal_hold" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "legal_hold_reason" TEXT;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "legal_hold_categories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "legal_hold_set_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "businesses_lifecycle_status_idx" ON "businesses"("lifecycle_status");

-- Employee anonymization marker (membership_anon later)
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "anonymized_at" TIMESTAMP(3);

-- Job outbox (workers not enabled in Slice C)
CREATE TABLE IF NOT EXISTS "data_lifecycle_jobs" (
  "id" TEXT NOT NULL,
  "type" "DataLifecycleJobType" NOT NULL,
  "status" "DataLifecycleJobStatus" NOT NULL DEFAULT 'pending',
  "subject_type" VARCHAR(32) NOT NULL,
  "subject_id" VARCHAR(64) NOT NULL,
  "payload" JSONB,
  "not_before" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "completed_at" TIMESTAMP(3),
  CONSTRAINT "data_lifecycle_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "data_lifecycle_jobs_status_not_before_idx"
  ON "data_lifecycle_jobs"("status", "not_before");
CREATE INDEX IF NOT EXISTS "data_lifecycle_jobs_subject_type_subject_id_idx"
  ON "data_lifecycle_jobs"("subject_type", "subject_id");

-- Idempotent backfill: mirror is_active → account_status
UPDATE "User"
SET "account_status" = CASE
  WHEN "is_active" = true THEN 'active'::"AccountStatus"
  ELSE 'deactivated'::"AccountStatus"
END
WHERE "account_status" = 'active' AND "is_active" = false;

-- Soft-closed businesses
UPDATE "businesses"
SET "lifecycle_status" = 'soft_closed'::"BusinessLifecycle"
WHERE "deleted_at" IS NOT NULL AND "lifecycle_status" = 'active';
