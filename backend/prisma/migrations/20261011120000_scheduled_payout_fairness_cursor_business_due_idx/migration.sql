-- Phase D2: fair tick keyset cursor (per stream) + business due-account index.
-- NOT applied by automation — deploy only after review.

CREATE TABLE "scheduled_payout_tick_fairness_cursors" (
  "stream" VARCHAR(16) NOT NULL,
  "anchor_due_at" TIMESTAMP(3) NOT NULL,
  "anchor_account_id" VARCHAR(64) NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "scheduled_payout_tick_fairness_cursors_pkey" PRIMARY KEY ("stream")
);

CREATE INDEX "businesses_bank_payout_due_idx"
  ON "businesses" ("bank_payout_schedule", "bank_payout_next_scheduled_at");
