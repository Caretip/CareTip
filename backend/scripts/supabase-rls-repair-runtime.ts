/**
 * SEC-03 — RLS repair script behaviour in a Supabase-like role model (disposable PostgreSQL only).
 *
 *   CARETIP_ISOLATED_POSTGRES_URL=postgresql://<superuser>@127.0.0.1:<port>/<db> node scripts/safe-test.mjs test:supabase-rls-repair
 *
 * Builds roles like Supabase (anon, authenticated, service_role[BYPASSRLS], authenticator) plus a table
 * owner WITHOUT BYPASSRLS (worst case for the real `postgres` role), applies the real Prisma migrations as
 * that owner, then proves:
 *   0. baseline: anon can read public tables (the SEC-03 exposure)
 *   1. the previous script (FORCE RLS) locks the owner out — i.e. would break Prisma
 *   2. rollback Part A restores the owner
 *   3. v2 script: owner unaffected, anon/authenticated denied, idempotent, future tables covered
 *   4. Prisma migrations still run after v2
 *   5. verify_rls_readonly.sql runs inside a READ ONLY transaction
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const superUrl = process.env.CARETIP_ISOLATED_POSTGRES_URL?.trim();
if (!superUrl || !/@(127\.0\.0\.1|localhost)[:/]/.test(superUrl)) {
  console.error("supabase-rls-repair: CARETIP_ISOLATED_POSTGRES_URL (loopback superuser) required");
  process.exit(1);
}
const base = new URL(superUrl);
const DB = `caretip_rls_${Date.now().toString(36)}`;
const OWNER = "sbx_rls_owner";
const OWNER_PW = "sbx-rls-owner-local-only";
const AUTHN_PW = "sbx-authenticator-local-only";
const urlFor = (user: string, pw: string, db = DB) => {
  const u = new URL(superUrl);
  u.username = user;
  u.password = pw;
  u.pathname = `/${db}`;
  return u.toString();
};

let failures = 0;
async function check(name: string, fn: () => Promise<unknown> | unknown) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    failures++;
    console.log(`FAIL ${name}: ${err instanceof Error ? err.message : String(err)}`);
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

/** Runs `sql` as `anon` / `authenticated` / `service_role` the way PostgREST does (authenticator + SET ROLE). */
async function asApiRole(role: string, sql: string): Promise<{ rows?: number; error?: string }> {
  return withClient(urlFor("authenticator", AUTHN_PW), async (c) => {
    await c.query(`SET ROLE ${role}`);
    try {
      const r = await c.query(sql);
      return { rows: Number(r.rows[0]?.n ?? r.rowCount ?? 0) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });
}

const ownerCount = (table: string) =>
  withClient(urlFor(OWNER, OWNER_PW), async (c) => Number((await c.query(`SELECT count(*)::int AS n FROM public."${table}"`)).rows[0].n));

// ---------------------------------------------------------------------------- environment
await withClient(superUrl, async (c) => {
  for (const [role, attrs] of [
    ["anon", "NOLOGIN NOINHERIT"],
    ["authenticated", "NOLOGIN NOINHERIT"],
    ["service_role", "NOLOGIN NOINHERIT BYPASSRLS"],
  ] as const) {
    await c.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${role} ${attrs}; END IF; END $$`);
  }
  await c.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticator') THEN CREATE ROLE authenticator LOGIN NOINHERIT PASSWORD '${AUTHN_PW}'; END IF; END $$`);
  await c.query(`ALTER ROLE authenticator PASSWORD '${AUTHN_PW}'`);
  await c.query(`GRANT anon, authenticated, service_role TO authenticator`);
  await c.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${OWNER}') THEN CREATE ROLE ${OWNER} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE PASSWORD '${OWNER_PW}'; END IF; END $$`);
  await c.query(`ALTER ROLE ${OWNER} NOSUPERUSER NOBYPASSRLS PASSWORD '${OWNER_PW}'`);
  await c.query(`CREATE DATABASE ${DB} OWNER ${OWNER}`);
});
await withClient(urlFor(base.username, decodeURIComponent(base.password)), async (c) => {
  // Supabase-like defaults: API roles may use the schema and get every table the owner creates.
  await c.query(`ALTER SCHEMA public OWNER TO ${OWNER}`);
  await c.query(`GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role`);
  await c.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${OWNER} IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role`);
  await c.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${OWNER} IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role`);
});

function migrateDeploy(): string {
  const r = spawnSync(process.execPath, [path.join(backendRoot, "node_modules/prisma/build/index.js"), "migrate", "deploy"], {
    cwd: backendRoot,
    env: { ...process.env, DATABASE_URL: urlFor(OWNER, OWNER_PW), DIRECT_URL: urlFor(OWNER, OWNER_PW) },
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`migrate deploy failed: ${(r.stderr || r.stdout).slice(-400)}`);
  return r.stdout;
}

await check("Prisma migrations apply as a non-superuser owner without BYPASSRLS", () => migrateDeploy());
const migrationsRows = await ownerCount("_prisma_migrations");

/** Inserts one row with type-based dummy values for every NOT NULL column without a default. */
async function insertDummyRow(table: string): Promise<void> {
  await withClient(urlFor(OWNER, OWNER_PW), async (c) => {
    const cols = (
      await c.query(
        `SELECT c.column_name, c.data_type, c.udt_name FROM information_schema.columns c
         WHERE c.table_schema='public' AND c.table_name=$1 AND c.is_nullable='NO' AND c.column_default IS NULL`,
        [table],
      )
    ).rows as Array<{ column_name: string; data_type: string; udt_name: string }>;
    const names: string[] = [];
    const values: string[] = [];
    for (const col of cols) {
      names.push(`"${col.column_name}"`);
      if (col.data_type === "USER-DEFINED") {
        const label = (await c.query(`SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname=$1 ORDER BY e.enumsortorder LIMIT 1`, [col.udt_name])).rows[0]?.enumlabel;
        values.push(`'${label}'::"${col.udt_name}"`);
      } else if (/timestamp|date/.test(col.data_type)) values.push("now()");
      else if (col.data_type === "boolean") values.push("false");
      else if (/int|numeric|double|real/.test(col.data_type)) values.push("0");
      else if (/json/.test(col.data_type)) values.push("'{}'");
      else values.push(`'sbx-${col.column_name}-${Date.now()}'`);
    }
    await c.query(`INSERT INTO public."${table}" (${names.join(",")}) VALUES (${values.join(",")})`);
  });
}
await insertDummyRow("User");
const userRows = await ownerCount("User");

// ---------------------------------------------------------------------------- 0. baseline exposure
await check("baseline (SEC-03): anon can read public tables before the repair", async () => {
  const r = await asApiRole("anon", `SELECT count(*)::int AS n FROM public."_prisma_migrations"`);
  assert.equal(r.error, undefined, r.error);
  assert.equal(r.rows, migrationsRows);
  const u = await asApiRole("anon", `SELECT count(*)::int AS n FROM public."User"`);
  assert.equal(u.error, undefined, "anon has SELECT on User (password hashes)");
});

// ---------------------------------------------------------------------------- 1. old script (FORCE)
const oldScript = execFileSync("git", ["show", "HEAD:backend/prisma/repair/enable_rls_public_tables.sql"], {
  cwd: backendRoot,
  encoding: "utf8",
});
await check("previous script FORCEs RLS and locks the table owner (Prisma) out", async () => {
  assert.match(oldScript, /FORCE ROW LEVEL SECURITY/);
  await withClient(urlFor(OWNER, OWNER_PW), (c) => c.query(oldScript));
  assert.ok(userRows > 0, "seeded a User row");
  assert.equal(await ownerCount("User"), 0, "owner should see 0 User rows under FORCE with no policies");
});

// ---------------------------------------------------------------------------- 2. rollback
const rollback = readFileSync(path.join(backendRoot, "prisma/repair/rollback_rls_public_tables.sql"), "utf8");
await check("rollback Part A removes FORCE and restores the owner", async () => {
  await withClient(urlFor(OWNER, OWNER_PW), (c) => c.query(rollback));
  assert.equal(await ownerCount("User"), userRows);
  assert.equal(await ownerCount("_prisma_migrations"), migrationsRows);
});

// ---------------------------------------------------------------------------- 3. v2 script
const v2 = readFileSync(path.join(backendRoot, "prisma/repair/enable_rls_public_tables.sql"), "utf8");
await check("v2 script does not use FORCE and runs in one transaction", () => {
  const executable = v2.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.doesNotMatch(executable, /FORCE ROW LEVEL SECURITY/);
  assert.match(executable, /^BEGIN;/m);
  assert.match(executable, /^COMMIT;/m);
});
await check("v2 applies cleanly and is idempotent (second run)", async () => {
  await withClient(urlFor(OWNER, OWNER_PW), async (c) => {
    await c.query(v2);
    await c.query(v2);
  });
});
await check("v2: every public table has RLS, none forced", async () => {
  const r = await withClient(urlFor(OWNER, OWNER_PW), (c) =>
    c.query(`SELECT count(*) FILTER (WHERE NOT c.relrowsecurity)::int AS off, count(*) FILTER (WHERE c.relforcerowsecurity)::int AS forced
             FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')`),
  );
  assert.deepEqual(r.rows[0], { off: 0, forced: 0 });
});
await check("v2: table owner (Prisma) still reads and writes", async () => {
  assert.equal(await ownerCount("_prisma_migrations"), migrationsRows);
  assert.equal(await ownerCount("User"), userRows);
  await insertDummyRow("User");
  assert.equal(await ownerCount("User"), userRows + 1, "owner INSERT works under v2");
  await withClient(urlFor(OWNER, OWNER_PW), async (c) => {
    await c.query(`CREATE TEMP TABLE t AS SELECT 1`);
    await c.query(`UPDATE public."_prisma_migrations" SET logs = logs WHERE false`);
    await c.query(`INSERT INTO public.legal_documents (id, kind, locale, title, html, version, updated_at)
                   SELECT 'sbx', kind, locale, 'x', '<p>x</p>', 'v1', now() FROM (SELECT 'privacy'::text AS kind, 'en'::text AS locale) s
                   WHERE EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='legal_documents' AND column_name='html')
                   ON CONFLICT DO NOTHING`).catch(() => undefined);
  });
});
for (const role of ["anon", "authenticated"]) {
  await check(`v2: ${role} is denied on sensitive tables`, async () => {
    for (const t of ["User", "refresh_tokens", "tips", "tip_refunds", "payment_discrepancies", "payment_operation_leases", "physical_qr_payment_adjustments", "stripe_customer_creations", "_prisma_migrations"]) {
      const r = await asApiRole(role, `SELECT count(*)::int AS n FROM public."${t}"`);
      assert.match(r.error ?? "", /permission denied/, `${role} on ${t}: ${JSON.stringify(r)}`);
    }
    const w = await asApiRole(role, `INSERT INTO public."_prisma_migrations"(id, checksum, migration_name, started_at, applied_steps_count) VALUES ('x','x','x',now(),0)`);
    assert.match(w.error ?? "", /permission denied/);
  });
}
await check("v2: even if a grant is re-added later, RLS (no policy) still returns no rows to anon", async () => {
  await withClient(urlFor(OWNER, OWNER_PW), (c) => c.query(`GRANT SELECT ON public."_prisma_migrations" TO anon`));
  const r = await asApiRole("anon", `SELECT count(*)::int AS n FROM public."_prisma_migrations"`);
  assert.equal(r.rows, 0);
  await withClient(urlFor(OWNER, OWNER_PW), (c) => c.query(`REVOKE SELECT ON public."_prisma_migrations" FROM anon`));
});
await check("v2: tables created later are not granted to anon (default privileges revoked)", async () => {
  await withClient(urlFor(OWNER, OWNER_PW), (c) => c.query(`CREATE TABLE public.sbx_future_table (id int primary key)`));
  const r = await asApiRole("anon", `SELECT count(*)::int AS n FROM public.sbx_future_table`);
  assert.match(r.error ?? "", /permission denied/);
});
await check("verify query Q9 lists a new table without RLS; re-running v2 covers it", async () => {
  const verify = readFileSync(path.join(backendRoot, "prisma/repair/verify_rls_readonly.sql"), "utf8");
  const q9 = verify.split(/^-- Q9\./m)[1]!.split(/^-- Q10\./m)[0]!;
  const sql = q9.slice(q9.indexOf("SELECT"));
  const before = await withClient(urlFor(OWNER, OWNER_PW), (c) => c.query(sql));
  assert.deepEqual(before.rows.map((r) => r.table_without_rls), ["sbx_future_table"]);
  await withClient(urlFor(OWNER, OWNER_PW), (c) => c.query(v2));
  const after = await withClient(urlFor(OWNER, OWNER_PW), (c) => c.query(sql));
  assert.equal(after.rows.length, 0);
});
await check("service_role keeps its access (unchanged by default; optional block documented)", async () => {
  const r = await asApiRole("service_role", `SELECT count(*)::int AS n FROM public."_prisma_migrations"`);
  assert.equal(r.rows, migrationsRows);
});

// ---------------------------------------------------------------------------- 4. migrations after v2
await check("Prisma migrate deploy still succeeds after v2", () => {
  const out = migrateDeploy();
  assert.match(out, /No pending migrations|applied/i);
});

// ---------------------------------------------------------------------------- 5. read-only verification
await check("verify_rls_readonly.sql executes completely inside a READ ONLY transaction", async () => {
  const verify = readFileSync(path.join(backendRoot, "prisma/repair/verify_rls_readonly.sql"), "utf8");
  const statements = verify
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  assert.ok(statements.length >= 13, `expected >= 13 queries, got ${statements.length}`);
  for (const s of statements) assert.match(s, /^SELECT/i, `non-SELECT statement: ${s.slice(0, 60)}`);
  await withClient(urlFor(OWNER, OWNER_PW), async (c) => {
    await c.query("BEGIN READ ONLY");
    for (const s of statements) await c.query(s);
    await c.query("ROLLBACK");
  });
});

console.log(`disposable database: ${DB} (owner ${OWNER}, no BYPASSRLS)`);
console.log(failures ? `supabase-rls-repair: ${failures} failed` : "supabase-rls-repair: ok");
process.exit(failures ? 1 : 0);
