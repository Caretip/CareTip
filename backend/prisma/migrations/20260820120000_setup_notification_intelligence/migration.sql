-- Class S setup notification intelligence (Stripe / verification / missing QR / profile photo).

DO $$ BEGIN
  CREATE TYPE "public"."SetupNotificationStatus" AS ENUM ('active', 'dismissed', 'actioned', 'resolved');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "setup_notification_states" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "notification_key" VARCHAR(191) NOT NULL,
    "business_id" TEXT,
    "status" "public"."SetupNotificationStatus" NOT NULL DEFAULT 'active',
    "condition_version" VARCHAR(64) NOT NULL,
    "dismissed_at" TIMESTAMP(3),
    "remind_at" TIMESTAMP(3),
    "actioned_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "setup_notification_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "setup_notification_states_user_id_notification_key_key"
  ON "setup_notification_states"("user_id", "notification_key");

CREATE INDEX IF NOT EXISTS "setup_notification_states_user_id_status_idx"
  ON "setup_notification_states"("user_id", "status");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'setup_notification_states_user_id_fkey'
  ) THEN
    ALTER TABLE "setup_notification_states"
      ADD CONSTRAINT "setup_notification_states_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
