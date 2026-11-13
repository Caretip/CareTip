-- CareTip — SEC-03 targeted privilege hardening (2026-11-13). OWNER-OPERATED.
--
-- Based on the production inspection of 2026-11-13 (combined Q0–Q13):
--   * 74/74 public tables have RLS; 23 also have FORCE RLS; no policies; owner `postgres` has BYPASSRLS.
--   * anon / authenticated hold no SELECT/INSERT/UPDATE/DELETE. They hold only TRUNCATE, REFERENCES,
--     TRIGGER (and MAINTAIN on PostgreSQL 17+) on public tables, and postgres' default privileges for
--     public tables grant them the same (`anon=Dxtm`, `authenticated=Dxtm`).
--   * information_schema does not list MAINTAIN; this script therefore reads pg_class.relacl /
--     pg_default_acl directly (aclexplode) for every check.
--
-- WHAT IT CHANGES (only this):
--   1. On ordinary/partitioned tables in schema public: revokes TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
--      from anon and authenticated — one REVOKE per privilege that is actually granted.
--   2. Default privileges FOR ROLE postgres IN SCHEMA public ON TABLES: revokes the same four
--      privileges from anon and authenticated — only those actually present.
--
-- WHAT IT NEVER TOUCHES: RLS enabled/FORCE flags, policies, the ensure_rls event trigger and
-- public.rls_auto_enable(), service_role, sequences, functions, views, schemas, supabase_admin /
-- Supabase-managed default privileges (storage, graphql, realtime, auth, extensions), table ownership,
-- data, columns, indexes, migrations.
--
-- SAFETY: one transaction. Every precondition and postcondition raises an exception, which rolls back
-- every statement. Idempotent: a second run revokes nothing and passes.
--
-- BEFORE RUNNING: run capture_anon_authenticated_privileges_readonly.sql and save its output — it is the
-- exact input for rollback_harden_anon_authenticated_privileges.sql. The NOTICE lines below repeat the
-- matching GRANT for every revoked privilege as a second record.
--
-- Expected values (from the inspection). If production has changed (new migration, new table), the
-- preconditions stop the script: re-run the inspection and update these numbers deliberately.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $harden$
DECLARE
  -- ── expected production state (2026-11-13 inspection) ────────────────────────────────────────────
  expected_public_tables CONSTANT int := 74;
  expected_forced_tables CONSTANT int := 23;
  expected_policies      CONSTANT int := 0;
  target_privileges      CONSTANT text[] := ARRAY['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'];
  client_roles           CONSTANT text[] := ARRAY['anon', 'authenticated'];

  -- Snapshot queries: everything that must be identical before and after. Each returns one text value,
  -- sorted by the line itself so the result is deterministic.
  q_tables text := $q$
    SELECT coalesce(string_agg(line, E'\n' ORDER BY line), '') FROM (
      SELECT format('%s|%s|%s|%s|%s', c.relname, c.relkind, pg_get_userbyid(c.relowner),
                    c.relrowsecurity, c.relforcerowsecurity) AS line
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')) s $q$;
  q_policies text := $q$
    SELECT coalesce(string_agg(line, E'\n' ORDER BY line), '') FROM (
      SELECT format('%s|%s|%s|%s|%s|%s|%s', p.polrelid::regclass, p.polname, p.polcmd, p.polpermissive,
                    p.polroles::text, pg_get_expr(p.polqual, p.polrelid),
                    pg_get_expr(p.polwithcheck, p.polrelid)) AS line
      FROM pg_policy p) s $q$;
  q_event_triggers text := $q$
    SELECT coalesce(string_agg(line, E'\n' ORDER BY line), '') FROM (
      SELECT format('%s|%s|%s|%s|%s|%s', e.evtname, e.evtevent, e.evtenabled, e.evtfoid::regprocedure,
                    e.evttags::text, pg_get_userbyid(e.evtowner)) AS line
      FROM pg_event_trigger e) s $q$;
  -- Relation ACL items of every grantee EXCEPT the four target privileges of anon/authenticated on public
  -- tables (the only thing allowed to change). Covers service_role, postgres, PUBLIC, sequences, views.
  q_other_relation_acls text := $q$
    SELECT coalesce(string_agg(line, E'\n' ORDER BY line), '') FROM (
      SELECT format('%s.%s|%s|%s|%s|%s|%s', n.nspname, c.relname, c.relkind,
                    CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
                    a.privilege_type, a.is_grantable, pg_get_userbyid(a.grantor)) AS line
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(c.relacl) a
      WHERE NOT (n.nspname = 'public' AND c.relkind IN ('r', 'p')
                 AND a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated'))
                 AND a.privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'))) s $q$;
  -- Default ACL items EXCEPT the four target privileges of anon/authenticated in postgres/public/tables.
  -- Covers supabase_admin, supabase_auth_admin, storage/graphql/realtime/extensions and service_role.
  q_other_default_acls text := $q$
    SELECT coalesce(string_agg(line, E'\n' ORDER BY line), '') FROM (
      SELECT format('%s|%s|%s|%s|%s|%s', pg_get_userbyid(d.defaclrole), coalesce(n.nspname, '(all)'),
                    d.defaclobjtype, CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
                    a.privilege_type, a.is_grantable) AS line
      FROM pg_default_acl d
      LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
      CROSS JOIN LATERAL aclexplode(d.defaclacl) a
      WHERE NOT (d.defaclrole = 'postgres'::regrole::oid AND n.nspname = 'public' AND d.defaclobjtype = 'r'
                 AND a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated'))
                 AND a.privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'))) s $q$;
  q_schema_function_acls text := $q$
    SELECT coalesce(string_agg(line, E'\n' ORDER BY line), '') FROM (
      SELECT format('schema %s|%s', nspname, nspacl::text) AS line FROM pg_namespace
      UNION ALL
      SELECT format('function %s|%s|%s', p.oid::regprocedure, pg_get_userbyid(p.proowner), p.proacl::text)
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public') s $q$;
  q_role_attributes text := $q$
    SELECT coalesce(string_agg(line, E'\n' ORDER BY line), '') FROM (
      SELECT format('%s|%s|%s|%s|%s', rolname, rolsuper, rolbypassrls, rolinherit, rolcanlogin) AS line
      FROM pg_roles
      WHERE rolname IN ('postgres', 'anon', 'authenticated', 'service_role', 'authenticator')) s $q$;

  before_tables text; before_policies text; before_event_triggers text; before_other_relation_acls text;
  before_other_default_acls text; before_schema_function_acls text; before_role_attributes text;
  after_value text;

  n_tables int; n_forced int; n_not_rls int; n_policies int; n_bad int;
  rec record;
  revoked_table_items int := 0;
  revoked_default_items int := 0;
BEGIN
  -- ── preconditions ────────────────────────────────────────────────────────────────────────────────
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'precondition: must run as postgres (table owner); current_user=%', current_user;
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN
    RAISE EXCEPTION 'precondition: PostgreSQL 17+ required (MAINTAIN privilege); server_version_num=%',
      current_setting('server_version_num');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'public' AND c.relname = '_prisma_migrations') THEN
    RAISE EXCEPTION 'precondition: public._prisma_migrations not found — not the CareTip database';
  END IF;
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('postgres', 'anon', 'authenticated', 'service_role')) <> 4 THEN
    RAISE EXCEPTION 'precondition: roles postgres, anon, authenticated, service_role must all exist';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('anon', 'authenticated') AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'precondition: anon/authenticated must not be superuser or BYPASSRLS';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres' AND rolbypassrls) THEN
    RAISE EXCEPTION 'precondition: postgres is expected to have BYPASSRLS (inspection Q4) — re-inspect';
  END IF;

  SELECT count(*), count(*) FILTER (WHERE c.relforcerowsecurity), count(*) FILTER (WHERE NOT c.relrowsecurity)
    INTO n_tables, n_forced, n_not_rls
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p');
  IF n_tables <> expected_public_tables OR n_forced <> expected_forced_tables OR n_not_rls <> 0 THEN
    RAISE EXCEPTION 'precondition: public tables=% (expected %), forced=% (expected %), without RLS=% (expected 0) — re-inspect',
      n_tables, expected_public_tables, n_forced, expected_forced_tables, n_not_rls;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relowner <> 'postgres'::regrole::oid) THEN
    RAISE EXCEPTION 'precondition: every public table must be owned by postgres';
  END IF;

  SELECT count(*) INTO n_policies FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public';
  IF n_policies <> expected_policies THEN
    RAISE EXCEPTION 'precondition: % policies on public tables (expected %) — re-inspect', n_policies, expected_policies;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_event_trigger e
                 WHERE e.evtname = 'ensure_rls' AND e.evtenabled <> 'D'
                   AND e.evtfoid = to_regprocedure('public.rls_auto_enable()')) THEN
    RAISE EXCEPTION 'precondition: enabled event trigger ensure_rls -> public.rls_auto_enable() not found';
  END IF;

  -- Client-role table privileges must be a subset of the four targets, granted by postgres, no GRANT OPTION.
  SELECT count(*) INTO n_bad
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL aclexplode(c.relacl) a
  JOIN pg_roles r ON r.oid = a.grantee
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND r.rolname = ANY (client_roles)
    AND (a.privilege_type <> ALL (target_privileges) OR a.is_grantable OR a.grantor <> 'postgres'::regrole::oid);
  IF n_bad > 0 THEN
    RAISE EXCEPTION 'precondition: % anon/authenticated table privilege(s) outside TRUNCATE/REFERENCES/TRIGGER/MAINTAIN, with GRANT OPTION, or not granted by postgres — re-inspect',
      n_bad;
  END IF;

  -- Same rule for postgres' default privileges on public tables.
  SELECT count(*) INTO n_bad
  FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace
  CROSS JOIN LATERAL aclexplode(d.defaclacl) a
  JOIN pg_roles r ON r.oid = a.grantee
  WHERE d.defaclrole = 'postgres'::regrole::oid AND n.nspname = 'public' AND d.defaclobjtype = 'r'
    AND r.rolname = ANY (client_roles)
    AND (a.privilege_type <> ALL (target_privileges) OR a.is_grantable);
  IF n_bad > 0 THEN
    RAISE EXCEPTION 'precondition: postgres default privileges on public tables grant anon/authenticated more than TRUNCATE/REFERENCES/TRIGGER/MAINTAIN — re-inspect';
  END IF;

  -- A database-wide (all schemas) default for postgres granting client roles would survive the
  -- schema-level revoke; none was found in the inspection.
  IF EXISTS (SELECT 1 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
             JOIN pg_roles r ON r.oid = a.grantee
             WHERE d.defaclrole = 'postgres'::regrole::oid AND d.defaclnamespace = 0 AND d.defaclobjtype = 'r'
               AND r.rolname = ANY (client_roles)) THEN
    RAISE EXCEPTION 'precondition: unexpected database-wide default privileges for postgres granting anon/authenticated — re-inspect';
  END IF;

  -- ── snapshot everything that must not change ─────────────────────────────────────────────────────
  EXECUTE q_tables INTO before_tables;
  EXECUTE q_policies INTO before_policies;
  EXECUTE q_event_triggers INTO before_event_triggers;
  EXECUTE q_other_relation_acls INTO before_other_relation_acls;
  EXECUTE q_other_default_acls INTO before_other_default_acls;
  EXECUTE q_schema_function_acls INTO before_schema_function_acls;
  EXECUTE q_role_attributes INTO before_role_attributes;

  -- ── change 1: existing public tables — revoke exactly what is granted ────────────────────────────
  FOR rec IN
    SELECT n.nspname, c.relname, r.rolname, a.privilege_type
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(c.relacl) a
    JOIN pg_roles r ON r.oid = a.grantee
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND r.rolname = ANY (client_roles)
      AND a.privilege_type = ANY (target_privileges)
    ORDER BY c.relname, r.rolname, a.privilege_type
  LOOP
    EXECUTE format('REVOKE %s ON TABLE %I.%I FROM %I', rec.privilege_type, rec.nspname, rec.relname, rec.rolname);
    revoked_table_items := revoked_table_items + 1;
    RAISE NOTICE 'revoked | rollback: GRANT % ON TABLE %.% TO %;',
      rec.privilege_type, quote_ident(rec.nspname), quote_ident(rec.relname), quote_ident(rec.rolname);
  END LOOP;

  -- ── change 2: postgres default privileges for future public tables ───────────────────────────────
  FOR rec IN
    SELECT DISTINCT r.rolname, a.privilege_type
    FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace
    CROSS JOIN LATERAL aclexplode(d.defaclacl) a
    JOIN pg_roles r ON r.oid = a.grantee
    WHERE d.defaclrole = 'postgres'::regrole::oid AND n.nspname = 'public' AND d.defaclobjtype = 'r'
      AND r.rolname = ANY (client_roles) AND a.privilege_type = ANY (target_privileges)
    ORDER BY r.rolname, a.privilege_type
  LOOP
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE %s ON TABLES FROM %I',
                   rec.privilege_type, rec.rolname);
    revoked_default_items := revoked_default_items + 1;
    RAISE NOTICE 'revoked default | rollback: ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT % ON TABLES TO %;',
      rec.privilege_type, quote_ident(rec.rolname);
  END LOOP;

  -- ── postconditions ───────────────────────────────────────────────────────────────────────────────
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             CROSS JOIN LATERAL aclexplode(c.relacl) a JOIN pg_roles r ON r.oid = a.grantee
             WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND r.rolname = ANY (client_roles)) THEN
    RAISE EXCEPTION 'postcondition: anon/authenticated still hold privileges on public tables';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace
             CROSS JOIN LATERAL aclexplode(d.defaclacl) a JOIN pg_roles r ON r.oid = a.grantee
             WHERE d.defaclrole = 'postgres'::regrole::oid AND n.nspname = 'public' AND d.defaclobjtype = 'r'
               AND r.rolname = ANY (client_roles)) THEN
    RAISE EXCEPTION 'postcondition: postgres default privileges still grant anon/authenticated on public tables';
  END IF;

  EXECUTE q_tables INTO after_value;
  IF after_value IS DISTINCT FROM before_tables THEN
    RAISE EXCEPTION 'postcondition: public tables / RLS / FORCE / ownership changed';
  END IF;
  EXECUTE q_policies INTO after_value;
  IF after_value IS DISTINCT FROM before_policies THEN
    RAISE EXCEPTION 'postcondition: policies changed';
  END IF;
  EXECUTE q_event_triggers INTO after_value;
  IF after_value IS DISTINCT FROM before_event_triggers THEN
    RAISE EXCEPTION 'postcondition: event triggers changed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_event_trigger e
                 WHERE e.evtname = 'ensure_rls' AND e.evtenabled <> 'D'
                   AND e.evtfoid = to_regprocedure('public.rls_auto_enable()')) THEN
    RAISE EXCEPTION 'postcondition: ensure_rls is no longer enabled on public.rls_auto_enable()';
  END IF;
  EXECUTE q_other_relation_acls INTO after_value;
  IF after_value IS DISTINCT FROM before_other_relation_acls THEN
    RAISE EXCEPTION 'postcondition: privileges other than the targeted anon/authenticated ones changed (service_role, postgres, PUBLIC, sequences or views)';
  END IF;
  EXECUTE q_other_default_acls INTO after_value;
  IF after_value IS DISTINCT FROM before_other_default_acls THEN
    RAISE EXCEPTION 'postcondition: other default privileges changed (service_role, supabase_admin or Supabase-managed schemas)';
  END IF;
  EXECUTE q_schema_function_acls INTO after_value;
  IF after_value IS DISTINCT FROM before_schema_function_acls THEN
    RAISE EXCEPTION 'postcondition: schema or public function privileges changed';
  END IF;
  EXECUTE q_role_attributes INTO after_value;
  IF after_value IS DISTINCT FROM before_role_attributes THEN
    RAISE EXCEPTION 'postcondition: role attributes changed';
  END IF;

  RAISE NOTICE 'SEC-03 hardening OK: % table privilege item(s) and % default privilege item(s) revoked; RLS, FORCE, policies, ensure_rls, service_role and Supabase-managed settings unchanged',
    revoked_table_items, revoked_default_items;
END
$harden$;

COMMIT;
