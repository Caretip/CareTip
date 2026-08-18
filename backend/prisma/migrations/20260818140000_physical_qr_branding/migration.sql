-- Physical CareTip Branding catalogue + orders.
-- Price remains NULL until officially supplied. Does not touch GDPR / lifecycle tables.

CREATE TYPE "PhysicalQrContextType" AS ENUM ('storefront', 'employee', 'table', 'location');
CREATE TYPE "PhysicalQrProcessingClass" AS ENUM ('SAME_DAY', 'WITHIN_24_HOURS');
CREATE TYPE "PhysicalQrPaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'CANCELLED');
CREATE TYPE "PhysicalQrFulfillmentStatus" AS ENUM (
  'PENDING_PAYMENT',
  'PAID',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
  'PAYMENT_FAILED'
);

CREATE TABLE "physical_qr_products" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "template_id" VARCHAR(64) NOT NULL,
  "preview_asset" TEXT,
  "supports_address" BOOLEAN NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "orderable" BOOLEAN NOT NULL DEFAULT false,
  "price_cents" INTEGER,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'EUR',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "physical_qr_products_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "physical_qr_orders" (
  "id" TEXT NOT NULL,
  "business_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "qr_context_type" "PhysicalQrContextType" NOT NULL,
  "qr_subject_id" TEXT,
  "qr_target_url_snapshot" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unit_price" INTEGER NOT NULL,
  "total_amount" INTEGER NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "placed_at" TIMESTAMP(3) NOT NULL,
  "processing_class" "PhysicalQrProcessingClass" NOT NULL,
  "processing_deadline_at" TIMESTAMP(3) NOT NULL,
  "processing_copy_snapshot" JSONB NOT NULL,
  "address_snapshot" JSONB,
  "color_tokens_snapshot" JSONB NOT NULL,
  "business_name_snapshot" VARCHAR(160) NOT NULL,
  "payment_status" "PhysicalQrPaymentStatus" NOT NULL DEFAULT 'PENDING',
  "fulfillment_status" "PhysicalQrFulfillmentStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
  "stripe_checkout_session_id" TEXT,
  "stripe_payment_intent_id" TEXT,
  "carrier" TEXT,
  "tracking_number" TEXT,
  "tracking_url" TEXT,
  "shipped_at" TIMESTAMP(3),
  "delivered_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "physical_qr_orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "physical_qr_orders_stripe_checkout_session_id_key"
  ON "physical_qr_orders"("stripe_checkout_session_id");
CREATE INDEX "physical_qr_orders_business_id_placed_at_idx"
  ON "physical_qr_orders"("business_id", "placed_at" DESC);
CREATE INDEX "physical_qr_orders_fulfillment_status_placed_at_idx"
  ON "physical_qr_orders"("fulfillment_status", "placed_at" DESC);
CREATE INDEX "physical_qr_orders_payment_status_idx"
  ON "physical_qr_orders"("payment_status");

ALTER TABLE "physical_qr_orders"
  ADD CONSTRAINT "physical_qr_orders_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "physical_qr_orders"
  ADD CONSTRAINT "physical_qr_orders_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "physical_qr_orders"
  ADD CONSTRAINT "physical_qr_orders_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "physical_qr_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "physical_qr_products"
  ("id", "name", "description", "template_id", "supports_address", "active", "orderable", "price_cents", "currency", "created_at", "updated_at")
VALUES
  (
    'caretip-a5-flyer-address',
    'CareTip A5 flyer with address',
    'A5 print with QR, business name, and printed address.',
    'caretip-a5-flyer',
    true,
    true,
    false,
    NULL,
    'EUR',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'caretip-a5-flyer-no-address',
    'CareTip A5 flyer without address',
    'A5 print with QR and business name only.',
    'caretip-a5-flyer',
    false,
    true,
    false,
    NULL,
    'EUR',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  );
