-- Payment integrity remediation (additive only: 4 new tables, 2 new enums, 4 new PhysicalQrPaymentStatus values).
-- Safe to apply while the previous release is running: no existing column, index or constraint is changed.
-- The ADD VALUE statements are not usable in the same transaction they are added in; nothing here uses them.

-- CreateEnum
CREATE TYPE "StripeRefundOperationStatus" AS ENUM ('pending', 'succeeded', 'failed_permanent');

-- CreateEnum
CREATE TYPE "PaymentDiscrepancyStatus" AS ENUM ('open', 'auto_repaired', 'resolved');

-- AlterEnum (PostgreSQL 12+ allows several ADD VALUE statements in one migration)
ALTER TYPE "PhysicalQrPaymentStatus" ADD VALUE IF NOT EXISTS 'IN_REVIEW';
ALTER TYPE "PhysicalQrPaymentStatus" ADD VALUE IF NOT EXISTS 'PARTIALLY_REFUNDED';
ALTER TYPE "PhysicalQrPaymentStatus" ADD VALUE IF NOT EXISTS 'REFUNDED';
ALTER TYPE "PhysicalQrPaymentStatus" ADD VALUE IF NOT EXISTS 'DISPUTED';

-- CreateTable
CREATE TABLE "payment_operation_leases" (
    "key" VARCHAR(191) NOT NULL,
    "token" VARCHAR(64) NOT NULL,
    "acquired_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_operation_leases_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "stripe_refund_operations" (
    "id" TEXT NOT NULL,
    "operation_key" VARCHAR(191) NOT NULL,
    "purpose" VARCHAR(64) NOT NULL,
    "stripe_payment_intent_id" TEXT NOT NULL,
    "amount_cents" INTEGER,
    "reverse_transfer" BOOLEAN NOT NULL DEFAULT false,
    "refund_application_fee" BOOLEAN NOT NULL DEFAULT false,
    "status" "StripeRefundOperationStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "key_generation" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "last_error_kind" VARCHAR(32),
    "last_error_code" VARCHAR(120),
    "last_error_message" VARCHAR(500),
    "stripe_refund_id" TEXT,
    "business_id" TEXT,
    "transaction_id" TEXT,
    "physical_qr_order_id" TEXT,
    "context" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "succeeded_at" TIMESTAMP(3),

    CONSTRAINT "stripe_refund_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_discrepancies" (
    "id" TEXT NOT NULL,
    "fingerprint" VARCHAR(191) NOT NULL,
    "workflow" VARCHAR(32) NOT NULL,
    "kind" VARCHAR(64) NOT NULL,
    "subject_key" VARCHAR(191) NOT NULL,
    "status" "PaymentDiscrepancyStatus" NOT NULL DEFAULT 'open',
    "business_id" TEXT,
    "stripe_payment_intent_id" TEXT,
    "stripe_checkout_session_id" TEXT,
    "transaction_id" TEXT,
    "physical_qr_order_id" TEXT,
    "details" JSONB,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "payment_discrepancies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "physical_qr_payment_adjustments" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "stripe_refund_id" TEXT,
    "stripe_dispute_id" TEXT,
    "stripe_payment_intent_id" TEXT,
    "stripe_charge_id" TEXT,
    "status" VARCHAR(32) NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "reason" VARCHAR(120),
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "physical_qr_payment_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_operation_leases_expires_at_idx" ON "payment_operation_leases"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "stripe_refund_operations_operation_key_key" ON "stripe_refund_operations"("operation_key");

-- CreateIndex
CREATE INDEX "stripe_refund_operations_status_next_attempt_at_idx" ON "stripe_refund_operations"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "stripe_refund_operations_stripe_payment_intent_id_idx" ON "stripe_refund_operations"("stripe_payment_intent_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_discrepancies_fingerprint_key" ON "payment_discrepancies"("fingerprint");

-- CreateIndex
CREATE INDEX "payment_discrepancies_status_workflow_idx" ON "payment_discrepancies"("status", "workflow");

-- CreateIndex
CREATE INDEX "payment_discrepancies_subject_key_idx" ON "payment_discrepancies"("subject_key");

-- CreateIndex
CREATE UNIQUE INDEX "physical_qr_payment_adjustments_stripe_refund_id_key" ON "physical_qr_payment_adjustments"("stripe_refund_id");

-- CreateIndex
CREATE UNIQUE INDEX "physical_qr_payment_adjustments_stripe_dispute_id_key" ON "physical_qr_payment_adjustments"("stripe_dispute_id");

-- CreateIndex
CREATE INDEX "physical_qr_payment_adjustments_order_id_idx" ON "physical_qr_payment_adjustments"("order_id");
