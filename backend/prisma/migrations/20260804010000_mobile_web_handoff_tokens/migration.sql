-- One-time mobile → web authentication handoff tokens (billing bridge).
CREATE TABLE IF NOT EXISTS "mobile_web_handoff_tokens" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "purpose" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumed_at" TIMESTAMP(3),
    "created_ip" VARCHAR(64),
    "created_user_agent" TEXT,

    CONSTRAINT "mobile_web_handoff_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "mobile_web_handoff_tokens_token_hash_key"
  ON "mobile_web_handoff_tokens"("token_hash");

CREATE INDEX IF NOT EXISTS "mobile_web_handoff_tokens_user_id_idx"
  ON "mobile_web_handoff_tokens"("user_id");

CREATE INDEX IF NOT EXISTS "mobile_web_handoff_tokens_expires_at_idx"
  ON "mobile_web_handoff_tokens"("expires_at");

CREATE INDEX IF NOT EXISTS "mobile_web_handoff_tokens_consumed_at_idx"
  ON "mobile_web_handoff_tokens"("consumed_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mobile_web_handoff_tokens_user_id_fkey'
  ) THEN
    ALTER TABLE "mobile_web_handoff_tokens"
      ADD CONSTRAINT "mobile_web_handoff_tokens_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
