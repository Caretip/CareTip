-- GDPR lifecycle Slice D.1 — Transaction.business + TipRefund.business Restrict.
-- Prevents accidental physical destruction of financial history via Business CASCADE.
-- Soft-close is unaffected (UPDATE only). No tip/refund row mutation.

-- ── tips.business_id → Restrict ──────────────────────────────────────────
ALTER TABLE "tips" DROP CONSTRAINT IF EXISTS "tips_business_id_fkey";
ALTER TABLE "tips"
  ADD CONSTRAINT "tips_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── tip_refunds.business_id → Restrict ───────────────────────────────────
ALTER TABLE "tip_refunds" DROP CONSTRAINT IF EXISTS "tip_refunds_business_id_fkey";
ALTER TABLE "tip_refunds"
  ADD CONSTRAINT "tip_refunds_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
