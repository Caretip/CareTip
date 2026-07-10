-- Global access-JWT invalidation counter (password change, refresh reuse, etc.).
ALTER TABLE "User" ADD COLUMN "auth_token_version" INTEGER NOT NULL DEFAULT 0;
