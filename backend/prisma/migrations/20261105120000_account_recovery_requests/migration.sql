-- Support-assisted recovery for employees who have lost their login email.
-- New table only: nothing existing changes. A reviewed, multi-step request needs durable state that
-- several people act on over days, which signed tokens cannot hold.
CREATE TABLE "account_recovery_requests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "login_email_at_request" TEXT NOT NULL,
    "replacement_email" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'awaiting_email_proof',
    "requester_ip_prefix" TEXT,
    "replacement_verified_at" TIMESTAMP(3),
    "eligible_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "identity_method" TEXT,
    "identity_evidence_ref" TEXT,
    "identity_verified_by_id" TEXT,
    "identity_verified_at" TIMESTAMP(3),
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "approval_reason" TEXT,
    "rejected_by_id" TEXT,
    "rejected_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_recovery_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "account_recovery_requests_status_created_at_idx" ON "account_recovery_requests"("status", "created_at");
CREATE INDEX "account_recovery_requests_user_id_idx" ON "account_recovery_requests"("user_id");

-- At most one open request per account, enforced by the database so concurrent requests cannot race.
CREATE UNIQUE INDEX "account_recovery_requests_one_open_per_user"
  ON "account_recovery_requests"("user_id")
  WHERE "status" IN ('awaiting_email_proof', 'awaiting_identity_review', 'awaiting_approval');

ALTER TABLE "account_recovery_requests"
  ADD CONSTRAINT "account_recovery_requests_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Supabase can expose public tables through its Data API. This table holds emails and identity notes
-- and only the API server reads it, so no client role gets access. The table owner, which is the
-- role Prisma connects as, is not restricted by RLS.
ALTER TABLE "account_recovery_requests" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  client_role text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE "account_recovery_requests" FROM %I', client_role);
    END IF;
  END LOOP;
END $$;
