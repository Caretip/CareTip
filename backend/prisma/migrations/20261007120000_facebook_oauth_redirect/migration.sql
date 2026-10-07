-- Facebook OAuth authorization-code redirect (state + completion handoff)
CREATE TABLE IF NOT EXISTS "facebook_oauth_states" (
    "id" VARCHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_ip" VARCHAR(64),
    "created_user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "facebook_oauth_states_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "facebook_oauth_states_expires_at_idx"
  ON "facebook_oauth_states"("expires_at");

CREATE TABLE IF NOT EXISTS "facebook_oauth_completions" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "payload" JSONB NOT NULL,
    "correlation_id" VARCHAR(128),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "facebook_oauth_completions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "facebook_oauth_completions_token_hash_key"
  ON "facebook_oauth_completions"("token_hash");

CREATE INDEX IF NOT EXISTS "facebook_oauth_completions_expires_at_idx"
  ON "facebook_oauth_completions"("expires_at");
