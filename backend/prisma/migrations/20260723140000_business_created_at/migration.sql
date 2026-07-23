-- Phase 13.5: Business.created_at for platform newBusinesses SSOT
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill from owning MANAGER user when available (safe for existing rows)
UPDATE "businesses" b
SET "created_at" = u."created_at"
FROM "User" u
WHERE b."user_id" = u.id
  AND u."created_at" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "businesses_created_at_idx" ON "businesses"("created_at" DESC);
