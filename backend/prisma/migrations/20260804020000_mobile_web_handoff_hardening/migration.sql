-- Harden mobile→web handoff: soft-consume + create-time IP/UA binding metadata.
ALTER TABLE "mobile_web_handoff_tokens"
  ADD COLUMN IF NOT EXISTS "consumed_at" TIMESTAMP(3);

ALTER TABLE "mobile_web_handoff_tokens"
  ADD COLUMN IF NOT EXISTS "created_ip" VARCHAR(64);

ALTER TABLE "mobile_web_handoff_tokens"
  ADD COLUMN IF NOT EXISTS "created_user_agent" TEXT;

CREATE INDEX IF NOT EXISTS "mobile_web_handoff_tokens_consumed_at_idx"
  ON "mobile_web_handoff_tokens"("consumed_at");
