/**
 * SEC-03 targeted privilege hardening — behaviour test in a production-shaped role model
 * (disposable loopback PostgreSQL 17+ only; never production).
 *
 *   CARETIP_ISOLATED_POSTGRES_URL=postgresql://<superuser>@127.0.0.1:<port>/<db> npm run test:sec03-privilege-hardening
 *
 * Models the 2026-11-13 production inspection:
 *   - table owner `postgres` (NOSUPERUSER, BYPASSRLS); anon / authenticated / service_role[BYPASSRLS]
 *   - real Prisma migrations → 74 public tables, all RLS, the 23 FORCE tables, no public policies
 *   - anon/authenticated/service_role hold TRUNCATE, REFERENCES, TRIGGER, MAINTAIN via postgres' default
 *     privileges (MAINTAIN deliberately missing on some tables — information_schema cannot show it)
 *   - Supabase-managed defaults (supabase_admin in public, postgres in storage), a storage policy
 *   - event trigger ensure_rls → public.rls_auto_enable() with NO tag filter (fires on every DDL,
 *     including the REVOKE / ALTER DEFAULT PRIVILEGES statements of the hardening — worst case)
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repairDir = path.join(backendRoot, "prisma/repair");
const superUrl = process.env.CARETIP_ISOLATED_POSTGRES_URL?.trim();
if (!superUrl || !/@(127\.0\.0\.1|localhost)[:/]/.test(superUrl)) {
  console.error("sec03-privilege-hardening: CARETIP_ISOLATED_POSTGRES_URL (loopback superuser) required");
  process.exit(1);
}
const DB = `sec03_priv_${Date.now().toString(36)}`;
const PG_PW = "sec03-postgres-local-only";
const urlFor = (user: string, pw: string | null, db = DB) => {
  const u = new URL(superUrl);
  u.username = user;
  if (pw !== null) u.password = pw;
  u.pathname = `/${db}`;
  return u.toString();
};
const superDbUrl = urlFor(new URL(superUrl).username, null);
const pgUrl = urlFor("postgres", PG_PW);

const HARDEN = readFileSync(path.join(repairDir, "harden_anon_authenticated_privileges.sql"), "utf8");
const CAPTURE = readFileSync(path.join(repairDir, "capture_anon_authenticated_privileges_readonly.sql"), "utf8");
const ROLLBACK = readFileSync(path.join(repairDir, "rollback_harden_anon_authenticated_privileges.sql"), "utf8");

const FORCED = [
  "User", "_EmployeeTableAssignments", "announcements", "audit_logs", "businesses", "email_verification_tokens",
  "employee_activation_tokens", "employee_goals", "employee_invite_redemptions", "employee_invites", "employees",
  "locations", "notifications", "password_reset_tokens", "push_device_tokens", "refresh_tokens",
  "stripe_webhook_events", "support_ticket_messages", "support_tickets", "tip_feedback", "tips", "user_settings",
  "venue_tables",
];
const NO_MAINTAIN = ["User", "tips", "employees", "businesses", "refresh_tokens", "tip_refunds", "audit_logs", "locations"];

let failures = 0;
async function check(name: string, fn: () => Promise<unknown> | unknown) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    failures++;
    console.log(`FAIL ${name}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
  }
}
async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}
/** Runs a whole SQL file as `postgres`; returns notices, or the error message. */
async function runAsPostgres(sql: string): Promise<{ ok: boolean; error?: string; notices: string[] }> {
  const c = new pg.Client({ connectionString: pgUrl });
  const notices: string[] = [];
  c.on("notice", (n) => notices.push(n.message ?? ""));
  await c.connect();
  try {
    await c.query(sql);
    return { ok: true, notices };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), notices };
  } finally {
    await c.end();
  }
}

type State = Record<string, string[]>;
/** Full observable state relevant to the scripts, as sorted line lists (aclexplode includes MAINTAIN). */
async function snapshot(): Promise<State> {
  return withClient(superDbUrl, async (c) => {
    const q = async (sql: string) => (await c.query(sql)).rows.map((r) => String(r.line)).sort();
    return {
      clientTable: await q(`SELECT c.relname||'|'||r.rolname||'|'||a.privilege_type||'|'||a.is_grantable||'|'||pg_get_userbyid(a.grantor) AS line
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(c.relacl) a
        JOIN pg_roles r ON r.oid=a.grantee WHERE n.nspname='public' AND c.relkind IN ('r','p') AND r.rolname IN ('anon','authenticated')`),
      clientDefault: await q(`SELECT r.rolname||'|'||a.privilege_type AS line FROM pg_default_acl d JOIN pg_namespace n ON n.oid=d.defaclnamespace
        CROSS JOIN LATERAL aclexplode(d.defaclacl) a JOIN pg_roles r ON r.oid=a.grantee
        WHERE d.defaclrole='postgres'::regrole::oid AND n.nspname='public' AND d.defaclobjtype='r' AND r.rolname IN ('anon','authenticated')`),
      serviceRoleTable: await q(`SELECT c.relname||'|'||a.privilege_type AS line FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE n.nspname='public' AND a.grantee='service_role'::regrole::oid`),
      otherDefaults: await q(`SELECT pg_get_userbyid(d.defaclrole)||'|'||coalesce(n.nspname,'(all)')||'|'||d.defaclobjtype::text||'|'||
          CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END||'|'||a.privilege_type AS line
        FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace CROSS JOIN LATERAL aclexplode(d.defaclacl) a
        WHERE NOT (d.defaclrole='postgres'::regrole::oid AND n.nspname='public' AND d.defaclobjtype='r'
                   AND pg_get_userbyid(a.grantee) IN ('anon','authenticated'))`),
      rls: await q(`SELECT c.relname||'|'||c.relrowsecurity||'|'||c.relforcerowsecurity||'|'||pg_get_userbyid(c.relowner) AS line
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')`),
      policies: await q(`SELECT polrelid::regclass||'|'||polname||'|'||polcmd::text||'|'||polroles::text AS line FROM pg_policy`),
      eventTriggers: await q(`SELECT evtname||'|'||evtevent||'|'||evtenabled::text||'|'||evtfoid::regprocedure||'|'||coalesce(evttags::text,'') AS line FROM pg_event_trigger`),
      schemaAcl: await q(`SELECT nspname||'|'||coalesce(nspacl::text,'') AS line FROM pg_namespace`),
      sequences: await q(`SELECT n.nspname||'.'||c.relname||'|'||coalesce(c.relacl::text,'') AS line FROM pg_class c
        JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='S' AND n.nspname='public'`),
    };
  });
}
const without = (s: State, ...keys: string[]) => Object.fromEntries(Object.entries(s).filter(([k]) => !keys.includes(k)));

// ─────────────────────────────────────────────────────────── production-shaped environment
await withClient(superUrl, async (c) => {
  const v = Number((await c.query("SHOW server_version_num")).rows[0].server_version_num);
  if (v < 170000) throw new Error(`PostgreSQL 17+ required for MAINTAIN (got ${v})`);
  const ensure = async (role: string, attrs: string) =>
    c.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE "${role}" ${attrs}; END IF; END $$`);
  await ensure("anon", "NOLOGIN");
  await ensure("authenticated", "NOLOGIN");
  await ensure("service_role", "NOLOGIN BYPASSRLS");
  await ensure("supabase_admin", "NOLOGIN");
  await ensure("postgres", `LOGIN NOSUPERUSER BYPASSRLS CREATEROLE PASSWORD '${PG_PW}'`);
  await c.query(`ALTER ROLE postgres LOGIN NOSUPERUSER BYPASSRLS PASSWORD '${PG_PW}'`);
  await c.query(`CREATE DATABASE ${DB} OWNER postgres`);
});
await withClient(superDbUrl, async (c) => {
  await c.query(`GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role`);
  // postgres' default privileges for public, as found in production (Q11: anon/authenticated/service_role = Dxtm).
  await c.query(`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES TO anon, authenticated, service_role`);
  await c.query(`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`);
  // Supabase-managed defaults that must stay untouched.
  await c.query(`ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role`);
  await c.query(`ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role`);
  await c.query(`CREATE SCHEMA storage AUTHORIZATION supabase_admin`);
  await c.query(`GRANT USAGE ON SCHEMA storage TO postgres, anon, authenticated, service_role`);
  await c.query(`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON TABLES TO anon, authenticated, service_role`);
  await c.query(`CREATE TABLE storage.objects (id bigint PRIMARY KEY, bucket_id text)`);
  await c.query(`ALTER TABLE storage.objects OWNER TO supabase_admin`);
  await c.query(`ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY`);
  await c.query(`CREATE POLICY objects_read ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'public')`);
  // ensure_rls → public.rls_auto_enable(): enables RLS on tables created in public. No tag filter on purpose.
  await c.query(`CREATE FUNCTION public.rls_auto_enable() RETURNS event_trigger LANGUAGE plpgsql AS $f$
    DECLARE obj record;
    BEGIN
      FOR obj IN SELECT * FROM pg_event_trigger_ddl_commands()
                 WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO') AND object_type = 'table'
                   AND schema_name = 'public'
      LOOP
        EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', obj.object_identity);
      END LOOP;
    END $f$`);
  await c.query(`CREATE EVENT TRIGGER ensure_rls ON ddl_command_end EXECUTE FUNCTION public.rls_auto_enable()`);
});

const mig = spawnSync(process.execPath, [path.join(backendRoot, "node_modules/prisma/build/index.js"), "migrate", "deploy"], {
  cwd: backendRoot,
  env: { ...process.env, DATABASE_URL: pgUrl, DIRECT_URL: pgUrl },
  encoding: "utf8",
});
if (mig.status !== 0) {
  console.error(`migrate deploy failed: ${(mig.stderr || mig.stdout).slice(-600)}`);
  process.exit(1);
}

await withClient(pgUrl, async (c) => {
  // Production shape: every table RLS (ensure_rls already did it), FORCE on the 23 original tables,
  // MAINTAIN missing on some older tables.
  const tables = (await c.query(`SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND relkind IN ('r','p')`)).rows.map((r) => r.relname as string);
  for (const t of tables) await c.query(`ALTER TABLE public."${t}" ENABLE ROW LEVEL SECURITY`);
  for (const t of FORCED) await c.query(`ALTER TABLE public."${t}" FORCE ROW LEVEL SECURITY`);
  // Migration 20261105120000 revokes client roles on account_recovery_requests, but production Q6 still
  // lists REFERENCES/TRIGGER/TRUNCATE for anon and authenticated there — model production, not the migration.
  await c.query(`GRANT TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.account_recovery_requests TO anon, authenticated, service_role`);
  for (const t of NO_MAINTAIN) await c.query(`REVOKE MAINTAIN ON TABLE public."${t}" FROM anon, authenticated`);
});

const S0 = await snapshot();

await check("model matches production: 74 tables, all RLS, 23 FORCE, 0 public policies, ensure_rls enabled", () => {
  assert.equal(S0.rls.length, 74);
  assert.equal(S0.rls.filter((l) => l.split("|")[1] !== "true").length, 0);
  assert.equal(S0.rls.filter((l) => l.split("|")[2] === "true").length, 23);
  assert.equal(S0.policies.filter((l) => !l.startsWith("storage.")).length, 0);
  assert.equal(S0.eventTriggers.length, 1);
  assert.match(S0.eventTriggers[0]!, /^ensure_rls\|ddl_command_end\|O\|rls_auto_enable\(\)/);
});
await check("model matches production grants: only Dxtm for anon/authenticated (MAINTAIN on some tables only)", () => {
  const privs = new Set(S0.clientTable.map((l) => l.split("|")[2]));
  assert.deepEqual([...privs].sort(), ["MAINTAIN", "REFERENCES", "TRIGGER", "TRUNCATE"]);
  assert.equal(S0.clientTable.length, 74 * 2 * 4 - NO_MAINTAIN.length * 2, `clientTable=${S0.clientTable.length}`);
  assert.deepEqual(S0.clientDefault, ["anon|MAINTAIN", "anon|REFERENCES", "anon|TRIGGER", "anon|TRUNCATE",
    "authenticated|MAINTAIN", "authenticated|REFERENCES", "authenticated|TRIGGER", "authenticated|TRUNCATE"],
    `clientDefault=${JSON.stringify(S0.clientDefault)}`);
  const seqHits = S0.sequences.filter((l) => /anon|authenticated/.test(l));
  assert.equal(seqHits.length, 0, `sequences=${JSON.stringify(seqHits)}`);
});
await check("information_schema hides MAINTAIN (why the scripts read relacl directly)", async () => {
  const r = await withClient(superDbUrl, (c) => c.query(`SELECT DISTINCT privilege_type FROM information_schema.role_table_grants WHERE table_schema='public' AND grantee='anon' ORDER BY 1`));
  assert.deepEqual(r.rows.map((x) => x.privilege_type), ["REFERENCES", "TRIGGER", "TRUNCATE"]);
});

// ─────────────────────────────────────────────────────────── capture (read-only)
let rollbackValues = "";
await check("capture runs entirely inside a READ ONLY transaction and lists exactly the targeted privileges", async () => {
  const rows = await withClient(pgUrl, async (c) => {
    await c.query("BEGIN READ ONLY");
    try {
      return (await c.query(CAPTURE)).rows as Array<{ section: string; detail: string }>;
    } finally {
      await c.query("ROLLBACK");
    }
  });
  assert.equal(rows.filter((r) => r.section === "unexpected").length, 0);
  assert.ok(rows.some((r) => r.section === "event_trigger" && r.detail.includes("ensure_rls")));
  rollbackValues = rows.find((r) => r.section === "rollback_values")!.detail;
  assert.equal(rollbackValues.split("\n").length, S0.clientTable.length + S0.clientDefault.length);
});

// ─────────────────────────────────────────────────────────── precondition failure → nothing changes
await check("precondition: unexpected SELECT grant aborts the whole script, nothing changes", async () => {
  await withClient(pgUrl, (c) => c.query(`GRANT SELECT ON TABLE public.tips TO anon`));
  const r = await runAsPostgres(HARDEN);
  assert.equal(r.ok, false);
  assert.match(r.error!, /precondition: 1 anon\/authenticated table privilege/);
  const s = await snapshot();
  assert.ok(s.clientTable.includes("tips|anon|SELECT|false|postgres"));
  await withClient(pgUrl, (c) => c.query(`REVOKE SELECT ON TABLE public.tips FROM anon`));
  assert.deepEqual(await snapshot(), S0);
});

// ─────────────────────────────────────────────────────────── postcondition failure → full rollback
await check("postcondition: an unexpected FORCE change during the run rolls back every revoke", async () => {
  await withClient(superDbUrl, async (c) => {
    await c.query(`CREATE FUNCTION public.sbx_sabotage() RETURNS event_trigger LANGUAGE plpgsql AS $f$
      BEGIN ALTER TABLE public.tips NO FORCE ROW LEVEL SECURITY; END $f$`);
    await c.query(`CREATE EVENT TRIGGER sbx_sabotage ON ddl_command_end WHEN TAG IN ('REVOKE') EXECUTE FUNCTION public.sbx_sabotage()`);
  });
  try {
    const r = await runAsPostgres(HARDEN);
    assert.equal(r.ok, false, "hardening should have failed");
    assert.match(r.error!, /postcondition: public tables \/ RLS \/ FORCE/);
  } finally {
    await withClient(superDbUrl, async (c) => {
      await c.query(`DROP EVENT TRIGGER sbx_sabotage`);
      await c.query(`DROP FUNCTION public.sbx_sabotage()`);
    });
  }
  const s = await snapshot();
  assert.deepEqual(s, S0, "state after the failed run must equal the original state");
  assert.ok(s.rls.includes("tips|true|true|postgres"));
});

// ─────────────────────────────────────────────────────────── successful repair
let S1: State = S0;
await check("hardening succeeds as postgres and revokes exactly the targeted items", async () => {
  const r = await runAsPostgres(HARDEN);
  assert.equal(r.ok, true, r.error);
  const tableNotices = r.notices.filter((n) => n.startsWith("revoked | rollback: GRANT"));
  const defaultNotices = r.notices.filter((n) => n.startsWith("revoked default"));
  assert.equal(tableNotices.length, S0.clientTable.length);
  assert.equal(defaultNotices.length, S0.clientDefault.length);
  S1 = await snapshot();
});
await check("after: anon/authenticated hold no table privileges and no postgres default privileges in public", () => {
  assert.deepEqual(S1.clientTable, []);
  assert.deepEqual(S1.clientDefault, []);
});
await check("after: RLS/FORCE, policies, ensure_rls, service_role, Supabase-managed defaults, schemas, sequences unchanged", () => {
  assert.deepEqual(without(S1, "clientTable", "clientDefault"), without(S0, "clientTable", "clientDefault"));
});
await check("after: a new public table gets no anon/authenticated grants, service_role keeps its default, RLS auto-enabled", async () => {
  await withClient(pgUrl, async (c) => {
    await c.query("BEGIN");
    try {
      await c.query(`CREATE TABLE public.sbx_new_table (id int)`);
      const acl = (await c.query(`SELECT relacl::text AS acl, relrowsecurity FROM pg_class WHERE oid='public.sbx_new_table'::regclass`)).rows[0];
      assert.ok(!/anon|authenticated/.test(acl.acl ?? ""), `acl=${acl.acl}`);
      assert.match(acl.acl, /service_role=Dxtm\/postgres/);
      assert.equal(acl.relrowsecurity, true);
    } finally {
      await c.query("ROLLBACK");
    }
  });
});
await check("idempotent: second run revokes nothing and leaves the same state", async () => {
  const r = await runAsPostgres(HARDEN);
  assert.equal(r.ok, true, r.error);
  assert.ok(r.notices.some((n) => n.includes("0 table privilege item(s) and 0 default privilege item(s) revoked")));
  assert.deepEqual(await snapshot(), S1);
});

// ─────────────────────────────────────────────────────────── rollback
await check("rollback refuses to run before the capture output is pasted", async () => {
  const r = await runAsPostgres(ROLLBACK);
  assert.equal(r.ok, false);
  assert.match(r.error!, /paste the capture/);
  assert.deepEqual(await snapshot(), S1);
});
const START = "-- >>> CAPTURED ROWS START";
const END = "-- <<< CAPTURED ROWS END";
const filledRollback = (() => {
  const a = ROLLBACK.indexOf(START);
  const b = ROLLBACK.indexOf(END);
  const lineEnd = ROLLBACK.indexOf("\n", a);
  return ROLLBACK.slice(0, lineEnd + 1) + rollbackValues + "\n" + ROLLBACK.slice(b);
})();
await check("rollback restores the original privilege state exactly (incl. MAINTAIN only where it was)", async () => {
  const r = await runAsPostgres(filledRollback);
  assert.equal(r.ok, true, r.error);
  const s = await snapshot();
  assert.deepEqual(s.clientTable, S0.clientTable);
  assert.deepEqual(s.clientDefault, S0.clientDefault);
  assert.deepEqual(s, S0);
});
await check("rollback is idempotent", async () => {
  const r = await runAsPostgres(filledRollback);
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(await snapshot(), S0);
});
await check("round trip: hardening again after rollback reaches the same hardened state", async () => {
  const r = await runAsPostgres(HARDEN);
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(await snapshot(), S1);
});

// ─────────────────────────────────────────────────────────── static scope checks
await check("hardening SQL: no REVOKE ALL, no RLS/FORCE/policy/event-trigger/ownership DDL, no service_role/sequence/supabase_admin change", () => {
  const code = HARDEN.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  for (const bad of [/REVOKE\s+ALL/i, /FORCE\s+ROW/i, /DISABLE\s+ROW/i, /ENABLE\s+ROW/i, /\bPOLICY\b/i, /(CREATE|ALTER|DROP)\s+EVENT\s+TRIGGER/i,
    /ALTER\s+TABLE/i, /OWNER\s+TO/i, /\bDROP\b/i, /\bCREATE\b/i, /\bGRANT\s+\w+\s+ON/i, /FROM\s+service_role/i,
    /TO\s+service_role/i, /SEQUENCES?\s+(IN|FROM)/i, /ON\s+SEQUENCE/i, /(ROLE|TO|FROM)\s+supabase_admin/i, /\bINSERT\b|\bUPDATE\b|\bDELETE\s+FROM/i]) {
    assert.ok(!bad.test(code), `found ${bad}`);
  }
  assert.ok(/^BEGIN;/m.test(code) && /^COMMIT;/m.test(code));
});
await check("capture SQL is a single read-only SELECT", () => {
  const code = CAPTURE.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.ok(!/\b(INSERT|UPDATE|DELETE|ALTER|GRANT|REVOKE|CREATE|DROP|TRUNCATE\s+TABLE|SET)\b/i.test(code.replace(/'[^']*'/g, "")));
  assert.equal(code.trim().split(";").filter((x) => x.trim()).length, 1);
});

// ─────────────────────────────────────────────────────────── cleanup
await withClient(superUrl, async (c) => {
  await c.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
});
console.log(`\ndisposable database ${DB} dropped`);
console.log(failures === 0 ? "sec03-privilege-hardening: all checks passed" : `sec03-privilege-hardening: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
