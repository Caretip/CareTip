-- Physical QR order lifecycle: PRINTING, timestamps, order thread, internal notes.
-- Does not touch GDPR / lifecycle tables or the print template.

ALTER TYPE "PhysicalQrFulfillmentStatus" ADD VALUE IF NOT EXISTS 'PRINTING';

ALTER TABLE "physical_qr_orders"
  ADD COLUMN IF NOT EXISTS "paid_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "processing_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "printing_at" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "physical_qr_order_messages" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "author_user_id" TEXT,
  "author_role" VARCHAR(16) NOT NULL,
  "body" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "physical_qr_order_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "physical_qr_order_internal_notes" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "author_user_id" TEXT,
  "body" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "physical_qr_order_internal_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "physical_qr_order_messages_order_id_created_at_idx"
  ON "physical_qr_order_messages"("order_id", "created_at");
CREATE INDEX IF NOT EXISTS "physical_qr_order_internal_notes_order_id_created_at_idx"
  ON "physical_qr_order_internal_notes"("order_id", "created_at");

ALTER TABLE "physical_qr_order_messages"
  ADD CONSTRAINT "physical_qr_order_messages_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "physical_qr_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "physical_qr_order_messages"
  ADD CONSTRAINT "physical_qr_order_messages_author_user_id_fkey"
  FOREIGN KEY ("author_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "physical_qr_order_internal_notes"
  ADD CONSTRAINT "physical_qr_order_internal_notes_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "physical_qr_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "physical_qr_order_internal_notes"
  ADD CONSTRAINT "physical_qr_order_internal_notes_author_user_id_fkey"
  FOREIGN KEY ("author_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
