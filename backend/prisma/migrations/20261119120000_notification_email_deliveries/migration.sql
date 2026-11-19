-- Durable outbox for notification emails (additive; no existing table changes).
-- Rollback: DROP TABLE "notification_email_deliveries"; DROP TYPE "NotificationEmailDeliveryStatus";

-- CreateEnum
CREATE TYPE "NotificationEmailDeliveryStatus" AS ENUM ('pending', 'processing', 'retry_scheduled', 'delivered', 'failed', 'cancelled');

-- CreateTable
CREATE TABLE "notification_email_deliveries" (
    "id" TEXT NOT NULL,
    "idempotency_key" VARCHAR(191) NOT NULL,
    "user_id" TEXT NOT NULL,
    "business_id" TEXT,
    "notification_id" TEXT,
    "kind" VARCHAR(64) NOT NULL,
    "to_email" VARCHAR(320) NOT NULL,
    "subject" VARCHAR(512) NOT NULL,
    "html" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" "NotificationEmailDeliveryStatus" NOT NULL DEFAULT 'pending',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 8,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_attempt_at" TIMESTAMP(3),
    "lease_owner" VARCHAR(64),
    "lease_until" TIMESTAMP(3),
    "last_error_kind" VARCHAR(32),
    "last_http_status" INTEGER,
    "provider_message_id" VARCHAR(128),
    "delivered_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_email_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_email_deliveries_idempotency_key_key" ON "notification_email_deliveries"("idempotency_key");

-- CreateIndex
CREATE INDEX "notification_email_deliveries_status_next_attempt_at_idx" ON "notification_email_deliveries"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "notification_email_deliveries_status_lease_until_idx" ON "notification_email_deliveries"("status", "lease_until");

-- CreateIndex
CREATE INDEX "notification_email_deliveries_user_id_created_at_idx" ON "notification_email_deliveries"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notification_email_deliveries_created_at_idx" ON "notification_email_deliveries"("created_at");

-- AddForeignKey
ALTER TABLE "notification_email_deliveries" ADD CONSTRAINT "notification_email_deliveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Supabase API roles get no access (same as other tables, see SEC-03); Prisma owns the table.
ALTER TABLE "notification_email_deliveries" ENABLE ROW LEVEL SECURITY;
