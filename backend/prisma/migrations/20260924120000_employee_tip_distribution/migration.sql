-- Off-platform employee tip distribution ledger (business_distribution only).
-- Immutable completed batches with payable-level allocation evidence.

CREATE TABLE "employee_tip_distribution_batches" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "completed_at" TIMESTAMP(3) NOT NULL,
    "total_amount_cents" INTEGER NOT NULL,
    "employee_count" INTEGER NOT NULL,
    "idempotency_key" VARCHAR(160) NOT NULL,
    "payment_reference" VARCHAR(120),
    "notes" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_tip_distribution_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "employee_tip_distribution_items" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "employee_id" TEXT,
    "amount_cents" INTEGER NOT NULL,
    "payment_reference" VARCHAR(120),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_tip_distribution_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "employee_tip_distribution_allocations" (
    "id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "employee_tip_payable_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_tip_distribution_allocations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "employee_tip_distribution_batches_business_id_idempotency_key_key"
    ON "employee_tip_distribution_batches"("business_id", "idempotency_key");

CREATE INDEX "employee_tip_distribution_batches_business_id_completed_at_idx"
    ON "employee_tip_distribution_batches"("business_id", "completed_at" DESC);

CREATE INDEX "employee_tip_distribution_items_batch_id_idx"
    ON "employee_tip_distribution_items"("batch_id");

CREATE INDEX "employee_tip_distribution_items_business_id_employee_id_idx"
    ON "employee_tip_distribution_items"("business_id", "employee_id");

CREATE INDEX "employee_tip_distribution_allocations_item_id_idx"
    ON "employee_tip_distribution_allocations"("item_id");

CREATE INDEX "employee_tip_distribution_allocations_business_id_idx"
    ON "employee_tip_distribution_allocations"("business_id");

CREATE INDEX "employee_tip_distribution_allocations_employee_tip_payable_id_idx"
    ON "employee_tip_distribution_allocations"("employee_tip_payable_id");

ALTER TABLE "employee_tip_distribution_batches"
    ADD CONSTRAINT "employee_tip_distribution_batches_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "employee_tip_distribution_batches"
    ADD CONSTRAINT "employee_tip_distribution_batches_actor_user_id_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "employee_tip_distribution_items"
    ADD CONSTRAINT "employee_tip_distribution_items_batch_id_fkey"
    FOREIGN KEY ("batch_id") REFERENCES "employee_tip_distribution_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "employee_tip_distribution_items"
    ADD CONSTRAINT "employee_tip_distribution_items_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "employee_tip_distribution_items"
    ADD CONSTRAINT "employee_tip_distribution_items_employee_id_fkey"
    FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "employee_tip_distribution_allocations"
    ADD CONSTRAINT "employee_tip_distribution_allocations_item_id_fkey"
    FOREIGN KEY ("item_id") REFERENCES "employee_tip_distribution_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "employee_tip_distribution_allocations"
    ADD CONSTRAINT "employee_tip_distribution_allocations_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "employee_tip_distribution_allocations"
    ADD CONSTRAINT "employee_tip_distribution_allocations_employee_tip_payable_id_fkey"
    FOREIGN KEY ("employee_tip_payable_id") REFERENCES "employee_tip_payables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
