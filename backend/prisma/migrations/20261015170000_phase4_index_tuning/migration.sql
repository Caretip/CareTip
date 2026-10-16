-- Index tuning (no data change). Rollback:
--   DROP INDEX IF EXISTS "employee_tip_payables_stripe_charge_id_idx";
--   CREATE INDEX IF NOT EXISTS "tips_business_id_idx" ON "tips" ("business_id");
--   CREATE INDEX IF NOT EXISTS "tips_employee_id_status_payout_status_idx" ON "tips" ("employee_id", "status", "payout_status");

-- Dispute webhooks without a payment intent resolve the payable by charge id.
CREATE INDEX IF NOT EXISTS "employee_tip_payables_stripe_charge_id_idx"
  ON "employee_tip_payables" ("stripe_charge_id");

-- Column-prefix of tips_business_id_status_created_at_idx, which also serves the business FK check.
DROP INDEX IF EXISTS "tips_business_id_idx";

-- Keyed on legacy tips.payout_status, which no application query reads (balances come from
-- employee_tip_payables); employee + status lookups use tips_employee_id_status_created_at_idx.
DROP INDEX IF EXISTS "tips_employee_id_status_payout_status_idx";
