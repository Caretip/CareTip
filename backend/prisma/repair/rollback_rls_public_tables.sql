-- CareTip — SEC-03 rollback. OWNER-OPERATED, emergency use only (see docs/security/sec-03-rls-runbook.md §Rollback).
--
-- The v2 repair (ENABLE without FORCE + revoke anon/authenticated) cannot block the table-owner role that
-- Prisma uses, so application failures after it are not expected. Use this only if, against expectation,
-- application queries fail with "permission denied" or return no rows after the change.
--
-- Part A (normally sufficient): remove FORCE if any table has it (the old script forced RLS — this is the
-- setting that can lock out the owner). Idempotent.
BEGIN;
DO $$
DECLARE rec record;
BEGIN
  FOR rec IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relforcerowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY', rec.relname);
    RAISE NOTICE 'FORCE removed: %', rec.relname;
  END LOOP;
END $$;
COMMIT;

-- Part B (only if Part A did not restore service): disable RLS on public tables again. This returns the
-- database to the pre-repair state for RLS — anon/authenticated stay without privileges (Part C restores
-- those, which re-opens the exposure and should be avoided).
-- BEGIN;
-- DO $$
-- DECLARE rec record;
-- BEGIN
--   FOR rec IN
--     SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity
--       AND c.relname <> 'account_recovery_requests'   -- had RLS before the repair (migration 20261105120000)
--   LOOP
--     EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', rec.relname);
--   END LOOP;
-- END $$;
-- COMMIT;

-- Part C (NOT recommended — re-creates the exposure SEC-03 is about). Restores Supabase's default grants.
-- GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
-- GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
-- ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
-- ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;
