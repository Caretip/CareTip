-- CareTip — SEC-03 rollback of harden_anon_authenticated_privileges.sql. OWNER-OPERATED.
--
-- Restores EXACTLY the anon/authenticated privileges recorded by
-- capture_anon_authenticated_privileges_readonly.sql immediately before the hardening — nothing broader.
--
-- HOW TO USE
--   1. Open the saved capture output; copy the single `rollback_values` cell.
--   2. Replace the placeholder row between the CAPTURED ROWS markers below with that text.
--      (Fallback if the capture was lost: the hardening run's NOTICE lines list one GRANT per revoked
--       privilege — convert each to a ('table'|'default_tables', object, grantee, privilege) row.)
--   3. Run the whole file once. It is one transaction; any failed check rolls everything back.
--
-- Restores: GRANT <privilege> ON TABLE public.<table> TO anon|authenticated (scope 'table') and
--           ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT <privilege> ON TABLES TO ...
--           (scope 'default_tables'), for TRUNCATE / REFERENCES / TRIGGER / MAINTAIN only.
-- Never touches: RLS / FORCE flags, policies, ensure_rls / rls_auto_enable(), service_role, sequences,
--                functions, schemas, supabase_admin or Supabase-managed default privileges, data.
-- Idempotent: running it twice leaves the same state.
-- Note: aclitem order inside relacl/defaclacl may differ from the original; the privileges are identical.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $rollback$
DECLARE
  restore jsonb := (
    SELECT coalesce(jsonb_agg(jsonb_build_object('scope', v.scope, 'object_name', v.object_name,
                                                 'grantee', v.grantee, 'privilege', v.privilege)), '[]'::jsonb)
    FROM (VALUES
-- >>> CAPTURED ROWS START (paste the capture's rollback_values cell here, replacing the next line)
('__PASTE_CAPTURE_OUTPUT_HERE__', '', '', '')
-- <<< CAPTURED ROWS END
    ) AS v(scope, object_name, grantee, privilege)
  );

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
  -- Current anon/authenticated target privileges, in the same row shape as the capture.
  q_current_targets text := $q$
    SELECT coalesce(jsonb_agg(jsonb_build_object('scope', scope, 'object_name', object_name,
                                                 'grantee', grantee, 'privilege', privilege)), '[]'::jsonb)
    FROM (
      SELECT 'table' AS scope, c.relname AS object_name, r.rolname AS grantee, a.privilege_type AS privilege
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(c.relacl) a JOIN pg_roles r ON r.oid = a.grantee
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND r.rolname IN ('anon', 'authenticated')
      UNION ALL
      SELECT 'default_tables', 'postgres/public', r.rolname, a.privilege_type
      FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace
      CROSS JOIN LATERAL aclexplode(d.defaclacl) a JOIN pg_roles r ON r.oid = a.grantee
      WHERE d.defaclrole = 'postgres'::regrole::oid AND n.nspname = 'public' AND d.defaclobjtype = 'r'
        AND r.rolname IN ('anon', 'authenticated')) s $q$;

  before_tables text; before_policies text; before_event_triggers text;
  before_other_relation_acls text; before_other_default_acls text;
  after_value text; current_targets jsonb; n_diff int;
  rec record;
BEGIN
  -- ── preconditions ────────────────────────────────────────────────────────────────────────────────
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'precondition: must run as postgres; current_user=%', current_user;
  END IF;
  IF restore @> '[{"scope": "__PASTE_CAPTURE_OUTPUT_HERE__"}]'::jsonb THEN
    RAISE EXCEPTION 'precondition: paste the capture''s rollback_values between the CAPTURED ROWS markers first';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(restore) AS x(scope text, object_name text, grantee text, privilege text)
             WHERE x.scope NOT IN ('table', 'default_tables')
                OR x.grantee NOT IN ('anon', 'authenticated')
                OR x.privilege NOT IN ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')
                OR (x.scope = 'default_tables' AND x.object_name <> 'postgres/public')) THEN
    RAISE EXCEPTION 'precondition: captured rows may only contain TRUNCATE/REFERENCES/TRIGGER/MAINTAIN for anon/authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(restore) AS x(scope text, object_name text, grantee text, privilege text)
             WHERE x.scope = 'table'
               AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                               WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname = x.object_name)) THEN
    RAISE EXCEPTION 'precondition: a captured table no longer exists in public';
  END IF;

  EXECUTE q_tables INTO before_tables;
  EXECUTE q_policies INTO before_policies;
  EXECUTE q_event_triggers INTO before_event_triggers;
  EXECUTE q_other_relation_acls INTO before_other_relation_acls;
  EXECUTE q_other_default_acls INTO before_other_default_acls;

  -- ── restore exactly the captured privileges ──────────────────────────────────────────────────────
  FOR rec IN
    SELECT * FROM jsonb_to_recordset(restore) AS x(scope text, object_name text, grantee text, privilege text)
    ORDER BY scope, object_name, grantee, privilege
  LOOP
    IF rec.scope = 'table' THEN
      EXECUTE format('GRANT %s ON TABLE public.%I TO %I', rec.privilege, rec.object_name, rec.grantee);
    ELSE
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT %s ON TABLES TO %I',
                     rec.privilege, rec.grantee);
    END IF;
  END LOOP;

  -- ── postconditions ───────────────────────────────────────────────────────────────────────────────
  -- anon/authenticated now hold exactly the captured set (no more, no less).
  EXECUTE q_current_targets INTO current_targets;
  SELECT count(*) INTO n_diff FROM (
    (SELECT * FROM jsonb_to_recordset(current_targets) AS a(scope text, object_name text, grantee text, privilege text)
     EXCEPT
     SELECT * FROM jsonb_to_recordset(restore) AS b(scope text, object_name text, grantee text, privilege text))
    UNION ALL
    (SELECT * FROM jsonb_to_recordset(restore) AS b(scope text, object_name text, grantee text, privilege text)
     EXCEPT
     SELECT * FROM jsonb_to_recordset(current_targets) AS a(scope text, object_name text, grantee text, privilege text))
  ) d;
  IF n_diff > 0 THEN
    RAISE EXCEPTION 'postcondition: anon/authenticated privileges differ from the captured set (% item(s))', n_diff;
  END IF;

  EXECUTE q_tables INTO after_value;
  IF after_value IS DISTINCT FROM before_tables THEN RAISE EXCEPTION 'postcondition: tables / RLS / FORCE changed'; END IF;
  EXECUTE q_policies INTO after_value;
  IF after_value IS DISTINCT FROM before_policies THEN RAISE EXCEPTION 'postcondition: policies changed'; END IF;
  EXECUTE q_event_triggers INTO after_value;
  IF after_value IS DISTINCT FROM before_event_triggers THEN RAISE EXCEPTION 'postcondition: event triggers changed'; END IF;
  EXECUTE q_other_relation_acls INTO after_value;
  IF after_value IS DISTINCT FROM before_other_relation_acls THEN RAISE EXCEPTION 'postcondition: other privileges changed'; END IF;
  EXECUTE q_other_default_acls INTO after_value;
  IF after_value IS DISTINCT FROM before_other_default_acls THEN RAISE EXCEPTION 'postcondition: other default privileges changed'; END IF;

  RAISE NOTICE 'SEC-03 rollback OK: % captured privilege item(s) restored exactly', jsonb_array_length(restore);
END
$rollback$;

COMMIT;
