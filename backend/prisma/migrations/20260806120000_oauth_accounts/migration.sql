-- OAuth multi-provider accounts (Google / Apple / Facebook)
-- Backfills from legacy User.oauth_provider / oauth_subject, then clears those columns.
-- Note: CareTip maps the User model to table "User" (PascalCase), not "users".

CREATE TABLE IF NOT EXISTS "oauth_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "email_at_link" TEXT,
    "display_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauth_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OAuthAccount_provider_subject_key"
  ON "oauth_accounts"("provider", "subject");

CREATE UNIQUE INDEX IF NOT EXISTS "OAuthAccount_user_provider_key"
  ON "oauth_accounts"("user_id", "provider");

CREATE INDEX IF NOT EXISTS "oauth_accounts_user_id_idx"
  ON "oauth_accounts"("user_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'oauth_accounts_user_id_fkey'
  ) THEN
    ALTER TABLE "oauth_accounts"
      ADD CONSTRAINT "oauth_accounts_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Backfill existing Google (and any other) single-slot OAuth bindings.
INSERT INTO "oauth_accounts" ("id", "user_id", "provider", "subject", "email_at_link", "display_name", "created_at", "updated_at")
SELECT
  'oa_' || replace(gen_random_uuid()::text, '-', ''),
  u.id,
  u.oauth_provider,
  u.oauth_subject,
  u.email,
  NULL,
  NOW(),
  NOW()
FROM "User" u
WHERE u.oauth_provider IS NOT NULL
  AND u.oauth_subject IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "oauth_accounts" oa
    WHERE oa.user_id = u.id AND oa.provider = u.oauth_provider
  )
  AND NOT EXISTS (
    SELECT 1 FROM "oauth_accounts" oa
    WHERE oa.provider = u.oauth_provider AND oa.subject = u.oauth_subject
  );

-- Stop relying on legacy columns (kept nullable for rollback compatibility).
UPDATE "User"
SET "oauth_provider" = NULL,
    "oauth_subject" = NULL
WHERE "oauth_provider" IS NOT NULL OR "oauth_subject" IS NOT NULL;
