-- Additive GDPR retention policy fields. Does not drop columns, rewrite history, or delete rows.
-- Nullable columns only; existing records are preserved. Backfill is not required for rollout.

-- User: 30-day anonymize eligibility + legal-hold release audit
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "anonymize_eligible_at" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "legal_hold_released_at" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "legal_hold_released_by_user_id" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "legal_hold_release_reason" TEXT;

-- Business: legal-hold release audit + tombstone timestamp
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "legal_hold_released_at" TIMESTAMP(3);
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "legal_hold_released_by_user_id" TEXT;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "legal_hold_release_reason" TEXT;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "tombstoned_at" TIMESTAMP(3);

-- AuditLog classification (existing rows → admin_audit; never 30-day-delete unclassified rows)
DO $$ BEGIN
  CREATE TYPE "AuditRetentionClass" AS ENUM ('admin_audit', 'security');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "retention_class" "AuditRetentionClass" NOT NULL DEFAULT 'admin_audit';
CREATE INDEX IF NOT EXISTS "audit_logs_retention_class_created_at_idx" ON "audit_logs" ("retention_class", "created_at");

-- Guest feedback name-anonymization marker
ALTER TABLE "tip_feedback" ADD COLUMN IF NOT EXISTS "name_anonymized_at" TIMESTAMP(3);

-- QR personal-session anonymization markers (rows retained for aggregates)
ALTER TABLE "qr_guest_visits" ADD COLUMN IF NOT EXISTS "anonymized_at" TIMESTAMP(3);
ALTER TABLE "qr_scan_events" ADD COLUMN IF NOT EXISTS "anonymized_at" TIMESTAMP(3);
ALTER TABLE "qr_funnel_events" ADD COLUMN IF NOT EXISTS "anonymized_at" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "qr_guest_visits_anonymized_at_idx" ON "qr_guest_visits" ("anonymized_at");
CREATE INDEX IF NOT EXISTS "qr_scan_events_anonymized_at_idx" ON "qr_scan_events" ("anonymized_at");
CREATE INDEX IF NOT EXISTS "qr_funnel_events_anonymized_at_idx" ON "qr_funnel_events" ("anonymized_at");
