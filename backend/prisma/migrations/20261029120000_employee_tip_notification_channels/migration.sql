-- Per-employee tip notification channels.
-- In-app stays on (existing inbox behavior). Tip email stays off (new channel, opt-in).
-- Tip push is copied from the existing push switch so a disabled push preference
-- does not start delivering tip push.
ALTER TABLE "employees"
  ADD COLUMN "tip_in_app_notifications" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "tip_push_notifications" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "tip_email_notifications" BOOLEAN NOT NULL DEFAULT false;

UPDATE "employees"
SET "tip_push_notifications" = "push_notifications";
