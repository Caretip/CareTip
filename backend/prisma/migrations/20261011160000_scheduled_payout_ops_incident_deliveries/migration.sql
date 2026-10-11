-- Phase C hardening: per-recipient in-app delivery state with leased claims.
-- NOT applied by automation.

CREATE TYPE "ScheduledPayoutOpsIncidentDeliveryChannel" AS ENUM ('in_app');

CREATE TYPE "ScheduledPayoutOpsIncidentDeliveryStatus" AS ENUM (
  'pending',
  'claimed',
  'delivered',
  'failed'
);

CREATE TABLE "scheduled_payout_ops_incident_deliveries" (
  "id" TEXT NOT NULL,
  "incident_id" TEXT NOT NULL,
  "notify_generation" INTEGER NOT NULL,
  "user_id" TEXT NOT NULL,
  "channel" "ScheduledPayoutOpsIncidentDeliveryChannel" NOT NULL DEFAULT 'in_app',
  "dedupe_key" VARCHAR(191) NOT NULL,
  "status" "ScheduledPayoutOpsIncidentDeliveryStatus" NOT NULL DEFAULT 'pending',
  "claim_token" VARCHAR(64),
  "claim_expires_at" TIMESTAMP(3),
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMP(3),
  "inbox_notification_id" VARCHAR(64),
  "last_error_code" VARCHAR(64),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "scheduled_payout_ops_incident_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "scheduled_payout_ops_incident_deliveries_unique"
  ON "scheduled_payout_ops_incident_deliveries" ("incident_id", "notify_generation", "user_id", "channel");

CREATE INDEX "scheduled_payout_ops_incident_deliveries_work_queue_idx"
  ON "scheduled_payout_ops_incident_deliveries" ("status", "next_attempt_at", "created_at");

ALTER TABLE "scheduled_payout_ops_incident_deliveries"
  ADD CONSTRAINT "scheduled_payout_ops_incident_deliveries_incident_id_fkey"
  FOREIGN KEY ("incident_id") REFERENCES "scheduled_payout_ops_incidents" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
