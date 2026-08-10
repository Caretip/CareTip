-- GDPR lifecycle Slice D — FK contract (M6–M11).
-- Expand nullability + SetNull/Restrict. No tip/financial row mutation.
-- Idempotent-ish: uses IF EXISTS / exception-safe patterns where practical.

-- ── AuditLog.user → SetNull ──────────────────────────────────────────────
ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "audit_logs_user_id_fkey";
ALTER TABLE "audit_logs" ALTER COLUMN "user_id" DROP NOT NULL;
ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Announcement.createdBy → SetNull ───────────────────────────────────
ALTER TABLE "announcements" DROP CONSTRAINT IF EXISTS "announcements_created_by_id_fkey";
ALTER TABLE "announcements" ALTER COLUMN "created_by_id" DROP NOT NULL;
ALTER TABLE "announcements"
  ADD CONSTRAINT "announcements_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ── SupportTicket.createdBy → SetNull ──────────────────────────────────
ALTER TABLE "support_tickets" DROP CONSTRAINT IF EXISTS "support_tickets_created_by_user_id_fkey";
ALTER TABLE "support_tickets" ALTER COLUMN "created_by_user_id" DROP NOT NULL;
ALTER TABLE "support_tickets"
  ADD CONSTRAINT "support_tickets_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ── SupportTicketMessage.author → SetNull ──────────────────────────────
ALTER TABLE "support_ticket_messages" DROP CONSTRAINT IF EXISTS "support_ticket_messages_author_user_id_fkey";
ALTER TABLE "support_ticket_messages" ALTER COLUMN "author_user_id" DROP NOT NULL;
ALTER TABLE "support_ticket_messages"
  ADD CONSTRAINT "support_ticket_messages_author_user_id_fkey"
  FOREIGN KEY ("author_user_id") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Employee.user → SetNull ────────────────────────────────────────────
ALTER TABLE "employees" DROP CONSTRAINT IF EXISTS "employees_user_id_fkey";
ALTER TABLE "employees" ALTER COLUMN "user_id" DROP NOT NULL;
ALTER TABLE "employees"
  ADD CONSTRAINT "employees_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Transaction.employee → SetNull (tips ledger survival) ──────────────
ALTER TABLE "tips" DROP CONSTRAINT IF EXISTS "tips_employee_id_fkey";
ALTER TABLE "tips" ALTER COLUMN "employee_id" DROP NOT NULL;
ALTER TABLE "tips"
  ADD CONSTRAINT "tips_employee_id_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "employees"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Business.user → Restrict ───────────────────────────────────────────
ALTER TABLE "businesses" DROP CONSTRAINT IF EXISTS "businesses_user_id_fkey";
ALTER TABLE "businesses"
  ADD CONSTRAINT "businesses_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── TipRefund.tip → optional FK SetNull ────────────────────────────────
-- Orphan tip_id values that do not match a tip row must be nulled before FK add.
UPDATE "tip_refunds" r
SET "tip_id" = NULL
WHERE r."tip_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "tips" t WHERE t."id" = r."tip_id");

ALTER TABLE "tip_refunds" DROP CONSTRAINT IF EXISTS "tip_refunds_tip_id_fkey";
ALTER TABLE "tip_refunds"
  ADD CONSTRAINT "tip_refunds_tip_id_fkey"
  FOREIGN KEY ("tip_id") REFERENCES "tips"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "tip_refunds_tip_id_idx" ON "tip_refunds"("tip_id");
