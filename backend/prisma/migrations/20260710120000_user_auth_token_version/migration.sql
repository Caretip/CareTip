-- Global access-JWT invalidation counter (password change, refresh reuse, etc.).
ALTER TABLE "users" ADD COLUMN "auth_token_version" INTEGER NOT NULL DEFAULT 0;
