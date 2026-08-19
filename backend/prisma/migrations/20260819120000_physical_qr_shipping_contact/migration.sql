-- Immutable delivery + contact snapshots for physical QR orders.
-- Does not backfill from live business profile. Does not change print artwork.

ALTER TABLE "physical_qr_orders"
  ADD COLUMN IF NOT EXISTS "shipping_snapshot" JSONB,
  ADD COLUMN IF NOT EXISTS "contact_snapshot" JSONB;
