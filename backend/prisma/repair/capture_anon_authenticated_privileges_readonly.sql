-- CareTip — SEC-03 pre-repair capture (READ-ONLY). Run in the Supabase SQL Editor IMMEDIATELY BEFORE
-- harden_anon_authenticated_privileges.sql and save the full output with the change record.
--
-- One SELECT over pg_class / pg_default_acl / pg_event_trigger. Changes nothing, reads no application rows.
--
-- Why this exists: information_schema does not list the MAINTAIN privilege, so the earlier inspection (Q6)
-- cannot tell which existing tables carry MAINTAIN. This capture reads the ACLs directly and produces the
-- exact list of privileges the hardening script will remove.
--
-- Output rows (section | detail):
--   summary_table_privileges   per role + privilege: how many public tables carry it
--   summary_default_privileges postgres default privileges on future public tables for anon/authenticated
--   unexpected                 any anon/authenticated privilege OUTSIDE the four targets (must be empty)
--   event_trigger              ensure_rls details (tags, function, enabled) for the record
--   rollback_values            ONE cell: paste it into rollback_harden_anon_authenticated_privileges.sql
--                              between the CAPTURED ROWS markers
WITH client AS (
  SELECT oid, rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')
),
table_items AS (
  SELECT c.relname AS object_name, cl.rolname AS grantee, a.privilege_type AS privilege
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL aclexplode(c.relacl) a
  JOIN client cl ON cl.oid = a.grantee
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
),
default_items AS (
  SELECT 'postgres/public'::text AS object_name, cl.rolname AS grantee, a.privilege_type AS privilege
  FROM pg_default_acl d
  JOIN pg_namespace n ON n.oid = d.defaclnamespace
  CROSS JOIN LATERAL aclexplode(d.defaclacl) a
  JOIN client cl ON cl.oid = a.grantee
  WHERE d.defaclrole = 'postgres'::regrole::oid AND n.nspname = 'public' AND d.defaclobjtype = 'r'
),
targets AS (
  SELECT 'table'::text AS scope, object_name, grantee, privilege FROM table_items
  WHERE privilege IN ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')
  UNION ALL
  SELECT 'default_tables', object_name, grantee, privilege FROM default_items
  WHERE privilege IN ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')
)
SELECT section, detail FROM (
  SELECT 1 AS ord, 'summary_table_privileges' AS section,
         format('%s %s on %s public table(s)', grantee, privilege, count(*)) AS detail, grantee || privilege AS k
  FROM table_items GROUP BY grantee, privilege
  UNION ALL
  SELECT 2, 'summary_default_privileges', format('postgres/public tables: %s %s', grantee, privilege), grantee || privilege
  FROM default_items
  UNION ALL
  SELECT 3, 'unexpected', format('%s %s on %s', grantee, privilege, object_name), object_name
  FROM (SELECT * FROM table_items UNION ALL SELECT * FROM default_items) x
  WHERE privilege NOT IN ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')
  UNION ALL
  SELECT 4, 'event_trigger',
         format('%s event=%s enabled=%s function=%s tags=%s owner=%s', e.evtname, e.evtevent, e.evtenabled,
                e.evtfoid::regprocedure, coalesce(e.evttags::text, '(all)'), pg_get_userbyid(e.evtowner)),
         e.evtname
  FROM pg_event_trigger e
  UNION ALL
  SELECT 5, 'rollback_values',
         coalesce(string_agg(format('(%L, %L, %L, %L)', scope, object_name, grantee, privilege), E',\n'
                             ORDER BY scope, object_name, grantee, privilege), '-- nothing to restore'),
         ''
  FROM targets
) r
ORDER BY ord, k;
