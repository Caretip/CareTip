-- CareTip-only QR receiving pause for 45-day tip inactivity.
-- Does not disconnect Stripe or change payouts_enabled.

ALTER TABLE "employees"
  ADD COLUMN IF NOT EXISTS "receiving_paused_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "receiving_paused_reason" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "receiving_resumed_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "inactivity_warning_sent_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "inactivity_admin_notified_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
