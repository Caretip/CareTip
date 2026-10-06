-- Allow multiple product-feedback submissions per user (history timeline).
DROP INDEX IF EXISTS "platform_product_feedback_user_id_key";

CREATE INDEX "platform_product_feedback_user_id_created_at_idx"
  ON "platform_product_feedback"("user_id", "created_at" DESC);
