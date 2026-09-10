-- Open/lost dispute exposure on employee tip payables (integer cents).
-- TipRefund.stripeDisputeId remains the Stripe dispute identity; these columns
-- are the payable freeze/loss amounts used for release and Transfer reversal.

ALTER TABLE "employee_tip_payables"
ADD COLUMN "disputed_open_cents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "disputed_lost_cents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "stripe_dispute_id" TEXT;

CREATE INDEX "employee_tip_payables_stripe_dispute_id_idx" ON "employee_tip_payables"("stripe_dispute_id");
