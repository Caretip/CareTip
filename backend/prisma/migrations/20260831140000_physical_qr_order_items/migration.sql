-- Parent order + line items: one checkout creates one physical_qr_orders row with many items.

CREATE TABLE "physical_qr_order_items" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "qr_context_type" "PhysicalQrContextType" NOT NULL,
    "qr_subject_id" TEXT,
    "qr_target_url_snapshot" TEXT NOT NULL,
    "label_snapshot" VARCHAR(200) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" INTEGER NOT NULL,
    "total_amount" INTEGER NOT NULL,
    "address_snapshot" JSONB,
    "color_tokens_snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "physical_qr_order_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "physical_qr_order_items_order_id_idx" ON "physical_qr_order_items"("order_id");

ALTER TABLE "physical_qr_order_items" ADD CONSTRAINT "physical_qr_order_items_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "physical_qr_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "physical_qr_order_items" ADD CONSTRAINT "physical_qr_order_items_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "physical_qr_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Allow parent orders to be header-only when line items carry per-QR details.
ALTER TABLE "physical_qr_orders" ALTER COLUMN "product_id" DROP NOT NULL;
ALTER TABLE "physical_qr_orders" ALTER COLUMN "qr_context_type" DROP NOT NULL;
ALTER TABLE "physical_qr_orders" ALTER COLUMN "qr_target_url_snapshot" DROP NOT NULL;
ALTER TABLE "physical_qr_orders" ALTER COLUMN "color_tokens_snapshot" DROP NOT NULL;
ALTER TABLE "physical_qr_orders" ALTER COLUMN "unit_price" SET DEFAULT 0;

-- Backfill one item per legacy single-item order.
INSERT INTO "physical_qr_order_items" (
    "id",
    "order_id",
    "product_id",
    "qr_context_type",
    "qr_subject_id",
    "qr_target_url_snapshot",
    "label_snapshot",
    "quantity",
    "unit_price",
    "total_amount",
    "address_snapshot",
    "color_tokens_snapshot",
    "created_at"
)
SELECT
    'pqi_' || "id",
    "id",
    "product_id",
    "qr_context_type",
    "qr_subject_id",
    COALESCE("qr_target_url_snapshot", ''),
    LEFT(COALESCE("business_name_snapshot", 'QR'), 200),
    "quantity",
    "unit_price",
    "total_amount",
    "address_snapshot",
    COALESCE("color_tokens_snapshot", '{}'::jsonb),
    "created_at"
FROM "physical_qr_orders"
WHERE "product_id" IS NOT NULL
  AND "qr_context_type" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "physical_qr_order_items" i WHERE i."order_id" = "physical_qr_orders"."id"
  );
