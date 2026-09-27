-- Albertina Part A: idempotent guest tip confirmation email (receipt stays in DB, not on success UI).
ALTER TABLE "tips" ADD COLUMN "guest_confirmation_email_sent_at" TIMESTAMP(3);
