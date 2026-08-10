-- Slice G: record which platform admin set a legal hold (structured actor id only).
-- User table is Prisma default "User"; Business maps to "businesses".
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "legal_hold_set_by_user_id" TEXT;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "legal_hold_set_by_user_id" TEXT;
