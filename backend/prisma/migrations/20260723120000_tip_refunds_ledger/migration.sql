-- Phase 13: Stripe refund / chargeback / dispute ledger (additive)

CREATE TYPE "TipRefundKind" AS ENUM ('refund', 'chargeback', 'dispute');
CREATE TYPE "TipRefundStatus" AS ENUM ('pending', 'succeeded', 'failed', 'canceled', 'needs_response', 'won', 'lost');

CREATE TABLE "tip_refunds" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "tip_id" TEXT,
    "stripe_refund_id" TEXT,
    "stripe_payment_intent_id" TEXT,
    "stripe_charge_id" TEXT,
    "stripe_dispute_id" TEXT,
    "kind" "TipRefundKind" NOT NULL,
    "status" "TipRefundStatus" NOT NULL DEFAULT 'pending',
    "amount_eur" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(8) NOT NULL DEFAULT 'eur',
    "reason" VARCHAR(120),
    "original_amount_eur" DECIMAL(10,2),
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tip_refunds_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tip_refunds_stripe_refund_id_key" ON "tip_refunds"("stripe_refund_id");
CREATE UNIQUE INDEX "tip_refunds_stripe_dispute_id_key" ON "tip_refunds"("stripe_dispute_id");
CREATE INDEX "tip_refunds_business_id_occurred_at_idx" ON "tip_refunds"("business_id", "occurred_at" DESC);
CREATE INDEX "tip_refunds_stripe_payment_intent_id_idx" ON "tip_refunds"("stripe_payment_intent_id");
CREATE INDEX "tip_refunds_kind_status_idx" ON "tip_refunds"("kind", "status");

ALTER TABLE "tip_refunds" ADD CONSTRAINT "tip_refunds_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
