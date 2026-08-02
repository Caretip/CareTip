-- Phase 3 — visit-scoped QR scan recording (one physical visit → one scan).

CREATE TYPE "qr_guest_visit_status" AS ENUM ('active', 'completed', 'expired');

CREATE TABLE "qr_guest_visits" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "session_id" VARCHAR(64) NOT NULL,
    "status" "qr_guest_visit_status" NOT NULL DEFAULT 'active',
    "scan_event_id" TEXT,
    "scan_type" VARCHAR(32) NOT NULL,
    "employee_id" TEXT,
    "location_id" TEXT,
    "table_id" TEXT,
    "qr_slug" VARCHAR(128),
    "entry_path" VARCHAR(512) NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qr_guest_visits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "qr_guest_visits_scan_event_id_key" ON "qr_guest_visits"("scan_event_id");

CREATE INDEX "qr_guest_visits_business_id_session_id_status_idx" ON "qr_guest_visits"("business_id", "session_id", "status");

CREATE INDEX "qr_guest_visits_business_id_status_idx" ON "qr_guest_visits"("business_id", "status");

CREATE INDEX "qr_guest_visits_expires_at_idx" ON "qr_guest_visits"("expires_at");

-- At most one active visit per business + guest session (allows new visits after complete/expired).
CREATE UNIQUE INDEX "qr_guest_visits_active_business_session_idx"
  ON "qr_guest_visits" ("business_id", "session_id")
  WHERE "status" = 'active';

ALTER TABLE "qr_guest_visits" ADD CONSTRAINT "qr_guest_visits_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "qr_guest_visits" ADD CONSTRAINT "qr_guest_visits_scan_event_id_fkey"
  FOREIGN KEY ("scan_event_id") REFERENCES "qr_scan_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
