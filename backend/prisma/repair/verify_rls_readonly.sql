-- CareTip — SEC-03 read-only RLS / privilege inspection for the Supabase SQL Editor.
-- Every statement is a SELECT against system catalogs. Nothing is changed. No secrets are needed or shown.
-- Run each query separately and keep the outputs with the change record (docs/security/sec-03-rls-runbook.md).

-- Q0. Who am I? (the role the SQL Editor uses — normally `postgres`)
SELECT current_user, session_user, current_database();

-- Q1. All public tables with RLS / FORCE flags and owner.
--     SAFE after repair: rls_enabled = true for every row; force_rls = false (see runbook).
SELECT c.relname                       AS table_name,
       c.relkind                       AS kind,
       pg_get_userbyid(c.relowner)     AS owner,
       c.relrowsecurity                AS rls_enabled,
       c.relforcerowsecurity           AS force_rls
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
ORDER BY c.relname;

-- Q2. Summary counts.
SELECT count(*)                                         AS public_tables,
       count(*) FILTER (WHERE c.relrowsecurity)          AS with_rls,
       count(*) FILTER (WHERE NOT c.relrowsecurity)      AS without_rls,
       count(*) FILTER (WHERE c.relforcerowsecurity)     AS forced
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p');

-- Q3. Distinct table owners. EXPECTED: one row (normally `postgres`). That role is what Prisma uses
--     (DATABASE_URL user `postgres.<ref>` maps to `postgres`). If owners differ, stop and review.
SELECT pg_get_userbyid(c.relowner) AS owner, count(*) AS tables
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
GROUP BY 1 ORDER BY 2 DESC;

-- Q4. Role attributes for the roles that matter.
--     The owner role does not need BYPASSRLS for the v2 script (owners are exempt unless FORCE is set).
--     anon/authenticated must NOT have BYPASSRLS. service_role normally HAS BYPASSRLS (Supabase design).
SELECT rolname, rolsuper, rolbypassrls, rolinherit, rolcanlogin, rolcreaterole
FROM pg_roles
WHERE rolname IN ('postgres', 'anon', 'authenticated', 'service_role', 'authenticator',
                  'supabase_admin', 'pgbouncer')
ORDER BY rolname;

-- Q5. Role memberships of the API roles (who can SET ROLE to whom).
SELECT r.rolname AS role, m.rolname AS member_of
FROM pg_auth_members am
JOIN pg_roles r ON r.oid = am.member
JOIN pg_roles m ON m.oid = am.roleid
WHERE r.rolname IN ('postgres', 'authenticator', 'anon', 'authenticated', 'service_role')
ORDER BY 1, 2;

-- Q6. Table privileges held by Supabase API roles on public tables.
--     SAFE after repair: zero rows for anon and authenticated.
SELECT grantee, table_name, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privileges
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated', 'service_role')
GROUP BY grantee, table_name
ORDER BY grantee, table_name;

-- Q7. Existing RLS policies on public tables. EXPECTED for CareTip: zero rows (default deny).
--     Any row here must be reviewed: CareTip does not authorise through SQL policies.
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- Q8. Unexpectedly broad policies (USING/WITH CHECK true, or granted to public/anon/authenticated).
SELECT tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND (qual IN ('true', '(true)') OR with_check IN ('true', '(true)')
       OR roles && ARRAY['public', 'anon', 'authenticated']::name[])
ORDER BY tablename;

-- Q9. Tables WITHOUT RLS (must be empty after repair; re-check after every migration that adds tables).
SELECT c.relname AS table_without_rls
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
ORDER BY 1;

-- Q10. Tables WITH RLS but no policy (expected for every CareTip table = deny for non-owners).
SELECT c.relname AS rls_table_without_policy
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity
  AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname)
ORDER BY 1;

-- Q11. Default privileges that would grant FUTURE tables/sequences to API roles.
--      SAFE after repair: no anon/authenticated entries for objtype r (tables) or S (sequences) in public.
SELECT pg_get_userbyid(d.defaclrole) AS for_objects_created_by,
       n.nspname                       AS schema,
       d.defaclobjtype                 AS objtype,   -- r = tables, S = sequences, f = functions
       d.defaclacl                     AS acl
FROM pg_default_acl d
LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
ORDER BY 1, 2, 3;

-- Q12. Schema privileges (USAGE lets a role see objects; without table grants it still cannot read them).
SELECT nspname, nspacl FROM pg_namespace WHERE nspname IN ('public', 'storage', 'auth');

-- Q13. Sequence privileges for API roles (should be empty for anon/authenticated after repair).
SELECT grantee, object_name AS sequence_name, privilege_type
FROM information_schema.role_usage_grants
WHERE object_schema = 'public' AND grantee IN ('anon', 'authenticated')
ORDER BY 1, 2;

-- Data API exposure (not SQL): Supabase Dashboard → Project Settings → API (Data API).
--   * "Exposed schemas" lists the schemas PostgREST serves; if `public` is listed, tables are reachable at
--     https://<ref>.supabase.co/rest/v1/<table> — but only as far as grants (Q6) and RLS (Q1/Q7) allow.
--   * A table is readable with the anon key only if: schema exposed AND anon has SELECT (Q6) AND
--     (RLS disabled OR a policy allows it). Knowing the anon key alone does not prove exposure.
--   * CareTip does not use the Data API; removing `public` from exposed schemas (or disabling the Data
--     API) is a valid additional hardening step, decided by the owner.
