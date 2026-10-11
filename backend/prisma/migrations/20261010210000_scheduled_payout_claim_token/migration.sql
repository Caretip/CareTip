-- Phase A.2: fencing token for scheduled payout processing claims (employee + business).

ALTER TABLE "stripe_connect_scheduled_payout_requests"
  ADD COLUMN "processing_claim_token" VARCHAR(64);

ALTER TABLE "employee_stripe_scheduled_payout_requests"
  ADD COLUMN "processing_claim_token" VARCHAR(64);
