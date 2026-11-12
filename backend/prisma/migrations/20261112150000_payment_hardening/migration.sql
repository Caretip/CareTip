-- Payment hardening (additive only): durable Stripe customer creation, QR hold-resolution audit,
-- and three nullable release columns on physical_qr_orders. No existing column is changed;
-- ADD COLUMN of nullable columns without defaults is a metadata-only change in PostgreSQL.

-- AlterTable
ALTER TABLE "physical_qr_orders" ADD COLUMN "hold_released_at" TIMESTAMP(3),
ADD COLUMN "hold_released_by_user_id" TEXT,
ADD COLUMN "hold_release_refunded_cents" INTEGER;

-- CreateTable
CREATE TABLE "physical_qr_hold_resolutions" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "admin_user_id" TEXT NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "previous_payment_status" VARCHAR(32) NOT NULL,
    "new_payment_status" VARCHAR(32) NOT NULL,
    "previous_fulfillment_status" VARCHAR(32) NOT NULL,
    "new_fulfillment_status" VARCHAR(32) NOT NULL,
    "reason" TEXT NOT NULL,
    "stripe_payment_intent_id" TEXT,
    "verified_amount_received_cents" INTEGER NOT NULL,
    "verified_refunded_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "physical_qr_hold_resolutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stripe_customer_creations" (
    "business_id" TEXT NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "idempotency_key" VARCHAR(191) NOT NULL,
    "key_generation" INTEGER NOT NULL DEFAULT 0,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "stripe_customer_id" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error_message" VARCHAR(500),
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stripe_customer_creations_pkey" PRIMARY KEY ("business_id")
);

-- CreateIndex
CREATE INDEX "physical_qr_hold_resolutions_order_id_created_at_idx" ON "physical_qr_hold_resolutions"("order_id", "created_at");
