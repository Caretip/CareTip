-- Employee tip payout routing + per-tip payable ledger (integer cents).

CREATE TYPE "EmployeeTipPayoutMode" AS ENUM ('direct_to_employee', 'business_distribution');
CREATE TYPE "EmployeeTipChargeModel" AS ENUM ('destination_employee', 'destination_business', 'platform_hold');
CREATE TYPE "EmployeeTipPayableStatus" AS ENUM ('held_platform', 'held_business', 'destination_settled', 'transferring', 'transferred', 'transfer_failed', 'refunded');

ALTER TABLE "businesses"
ADD COLUMN "employee_tip_payout_mode" "EmployeeTipPayoutMode" NOT NULL DEFAULT 'direct_to_employee';

CREATE TABLE "employee_tip_payables" (
    "id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "employee_id" TEXT,
    "business_id" TEXT NOT NULL,
    "routing_mode" "EmployeeTipPayoutMode" NOT NULL,
    "charge_model" "EmployeeTipChargeModel" NOT NULL,
    "status" "EmployeeTipPayableStatus" NOT NULL,
    "gross_cents" INTEGER NOT NULL,
    "platform_fee_cents" INTEGER NOT NULL,
    "payable_cents" INTEGER NOT NULL,
    "transferred_cents" INTEGER NOT NULL DEFAULT 0,
    "reversed_cents" INTEGER NOT NULL DEFAULT 0,
    "refunded_cents" INTEGER NOT NULL DEFAULT 0,
    "stripe_payment_intent_id" TEXT NOT NULL,
    "stripe_charge_id" TEXT,
    "stripe_destination_account_id" TEXT,
    "stripe_transfer_id" TEXT,
    "last_transfer_error" VARCHAR(180),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_tip_payables_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "employee_tip_payables_transaction_id_key" ON "employee_tip_payables"("transaction_id");
CREATE UNIQUE INDEX "employee_tip_payables_stripe_transfer_id_key" ON "employee_tip_payables"("stripe_transfer_id");
CREATE INDEX "employee_tip_payables_employee_id_status_idx" ON "employee_tip_payables"("employee_id", "status");
CREATE INDEX "employee_tip_payables_business_id_routing_mode_status_idx" ON "employee_tip_payables"("business_id", "routing_mode", "status");
CREATE INDEX "employee_tip_payables_stripe_payment_intent_id_idx" ON "employee_tip_payables"("stripe_payment_intent_id");
CREATE INDEX "employee_tip_payables_status_created_at_idx" ON "employee_tip_payables"("status", "created_at");

ALTER TABLE "employee_tip_payables" ADD CONSTRAINT "employee_tip_payables_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "tips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_tip_payables" ADD CONSTRAINT "employee_tip_payables_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employee_tip_payables" ADD CONSTRAINT "employee_tip_payables_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
