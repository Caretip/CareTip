-- Additive: currency of the dispute balance transactions, and a flag when they are not all in one currency
-- (then the funds totals are incomplete and the dispute needs reconciliation). No existing data is changed.
ALTER TABLE "stripe_disputes" ADD COLUMN "funds_currency" VARCHAR(8);
ALTER TABLE "stripe_disputes" ADD COLUMN "funds_currency_mixed" BOOLEAN NOT NULL DEFAULT false;
