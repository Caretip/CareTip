-- Albertina physical QR: monthly Pro free-order claim + order pricing/location snapshots.

ALTER TABLE "businesses"
  ADD COLUMN IF NOT EXISTS "physical_qr_free_order_used_at" TIMESTAMP(3);

ALTER TABLE "physical_qr_orders"
  ADD COLUMN IF NOT EXISTS "pricing_snapshot" JSONB,
  ADD COLUMN IF NOT EXISTS "monthly_free_quota_applied" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "physical_qr_order_items"
  ADD COLUMN IF NOT EXISTS "location_id" TEXT,
  ADD COLUMN IF NOT EXISTS "location_name_snapshot" VARCHAR(160);
