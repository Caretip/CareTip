-- Distributed one-time MFA challenge consume (unique jti).
CREATE TABLE IF NOT EXISTS "consumed_mfa_challenges" (
    "jti" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consumed_mfa_challenges_pkey" PRIMARY KEY ("jti")
);

CREATE INDEX IF NOT EXISTS "consumed_mfa_challenges_expires_at_idx" ON "consumed_mfa_challenges"("expires_at");
