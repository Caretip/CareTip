-- Activity Center Phase A: BusinessActivityEvent SSOT projection

CREATE TYPE "ActivityEventSource" AS ENUM ('TIPS', 'QR', 'GOALS', 'STAFF', 'PAYMENTS', 'SYSTEM');
CREATE TYPE "ActivityEventPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH');

CREATE TABLE "business_activity_events" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "source" "ActivityEventSource" NOT NULL,
    "priority" "ActivityEventPriority" NOT NULL DEFAULT 'NORMAL',
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "actor_employee_id" TEXT,
    "actor_user_id" TEXT,
    "location_id" TEXT,
    "table_id" TEXT,
    "subject_type" VARCHAR(32),
    "subject_id" VARCHAR(64),
    "dedupe_key" VARCHAR(191) NOT NULL,
    "summary" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_activity_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "business_activity_events_business_id_occurred_at_idx" ON "business_activity_events"("business_id", "occurred_at" DESC);
CREATE INDEX "business_activity_events_business_id_source_occurred_at_idx" ON "business_activity_events"("business_id", "source", "occurred_at" DESC);
CREATE INDEX "business_activity_events_business_id_type_occurred_at_idx" ON "business_activity_events"("business_id", "type", "occurred_at" DESC);
CREATE UNIQUE INDEX "business_activity_events_business_id_dedupe_key_key" ON "business_activity_events"("business_id", "dedupe_key");

ALTER TABLE "business_activity_events" ADD CONSTRAINT "business_activity_events_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
