-- CareTip — enable Row Level Security on every table in the public schema (SEC-03, v2 2026-11-12).
--
-- OWNER-OPERATED. Run only after: backup / PITR verified, read-only inspection
-- (`verify_rls_readonly.sql`) reviewed, and explicit approval. See docs/security/sec-03-rls-runbook.md.
--
-- Access model this script is written for (verify before running — query 4/5 of verify_rls_readonly.sql):
--   * The Express API (Prisma) and migrations connect as the role that OWNS the public tables
--     (Supabase: `postgres`, through the pooler as `postgres.<project-ref>`). Authorization is done in
--     Express middleware + Prisma, not in SQL policies.
--   * Supabase API roles `anon` / `authenticated` must have NO access to application tables.
--   * No application code reads tables through PostgREST / supabase-js (`service_role` is used for Storage only).
--
-- What it does (idempotent, single transaction, safe to re-run):
--   1. ENABLE ROW LEVEL SECURITY on every ordinary table in `public` that does not have it.
--      No policies are created → default deny for every role that does not own the table and does not
--      have BYPASSRLS (anon, authenticated, any future non-owner role).
--   2. Does NOT use FORCE ROW LEVEL SECURITY. FORCE would subject the table OWNER to RLS; with zero
--      policies every Prisma query would return no rows / fail unless the owner role has BYPASSRLS.
--      The previous version of this script forced RLS — do not use it (see runbook §Risks).
--   3. REVOKEs all table / sequence privileges on public objects from anon and authenticated, and stops
--      future tables created by the owner from being granted to them (ALTER DEFAULT PRIVILEGES).
--   4. Leaves `service_role` unchanged (Supabase Storage + platform tooling). Optional block at the end.
--   5. Never drops, renames or rewrites data; never changes the owner role's privileges.
--
-- New tables added by later Prisma migrations do NOT get RLS automatically: re-run this script (or the
-- per-table statements) after such migrations; verify_rls_readonly.sql query 9 lists any table without RLS.

BEGIN;

-- Fail fast if this is not the expected database layout.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'public') THEN
    RAISE EXCEPTION 'public schema not found — aborting';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = '_prisma_migrations'
  ) THEN
    RAISE EXCEPTION '_prisma_migrations not found in public — not the CareTip database? aborting';
  END IF;
END $$;

-- 1. Enable RLS (no FORCE) on every ordinary and partitioned table in public.
DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relrowsecurity = false
    ORDER BY c.relname
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', rec.relname);
    RAISE NOTICE 'RLS enabled: %', rec.relname;
  END LOOP;
END $$;

-- 2. Remove Supabase client-role privileges on existing objects and on objects created later by the
--    role running this script (the table owner). Guarded: roles may not exist outside Supabase.
DO $$
DECLARE
  client_role text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', client_role);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', client_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', client_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', client_role);
      RAISE NOTICE 'privileges revoked from %', client_role;
    END IF;
  END LOOP;
END $$;

-- 3. Post-condition: every public table has RLS; client roles hold no table privileges.
DO $$
DECLARE
  missing int;
  granted int;
BEGIN
  SELECT count(*) INTO missing
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity = false;
  IF missing > 0 THEN
    RAISE EXCEPTION 'post-check failed: % public table(s) still without RLS', missing;
  END IF;

  SELECT count(*) INTO granted
  FROM information_schema.role_table_grants g
  WHERE g.table_schema = 'public' AND g.grantee IN ('anon', 'authenticated');
  IF granted > 0 THEN
    RAISE EXCEPTION 'post-check failed: % grant(s) to anon/authenticated remain', granted;
  END IF;
END $$;

COMMIT;

-- OPTIONAL (separate decision, not part of the default change): also remove table privileges from
-- `service_role`. Only do this after confirming nothing (edge functions, dashboards, scripts) reads public
-- tables with the service-role key. Supabase Storage does not need public-table privileges.
--
-- BEGIN;
-- REVOKE ALL ON ALL TABLES IN SCHEMA public FROM service_role;
-- REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM service_role;
-- ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM service_role;
-- ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM service_role;
-- COMMIT;
