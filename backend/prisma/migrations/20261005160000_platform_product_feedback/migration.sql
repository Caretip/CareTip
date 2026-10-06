-- CareTip product review (manager/employee → platform). Independent of tip_feedback.

CREATE TYPE "PlatformProductFeedbackAdminStatus" AS ENUM ('new', 'read', 'archived');

CREATE TABLE "platform_product_feedback" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "submitter_role" "Role" NOT NULL,
    "business_id" TEXT,
    "employee_id" TEXT,
    "rating" SMALLINT NOT NULL,
    "comment" TEXT,
    "admin_status" "PlatformProductFeedbackAdminStatus" NOT NULL DEFAULT 'new',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_product_feedback_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "platform_product_feedback_user_id_key" ON "platform_product_feedback"("user_id");
CREATE INDEX "platform_product_feedback_admin_status_created_at_idx" ON "platform_product_feedback"("admin_status", "created_at" DESC);
CREATE INDEX "platform_product_feedback_business_id_idx" ON "platform_product_feedback"("business_id");
CREATE INDEX "platform_product_feedback_created_at_idx" ON "platform_product_feedback"("created_at" DESC);
CREATE INDEX "platform_product_feedback_submitter_role_idx" ON "platform_product_feedback"("submitter_role");

ALTER TABLE "platform_product_feedback" ADD CONSTRAINT "platform_product_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "platform_product_feedback" ADD CONSTRAINT "platform_product_feedback_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "platform_product_feedback" ADD CONSTRAINT "platform_product_feedback_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
