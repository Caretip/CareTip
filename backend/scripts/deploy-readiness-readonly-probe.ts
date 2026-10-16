/**
 * Read-only deployment-readiness probe: timestamp column drift, migration history/checksums and
 * index state. Catalog metadata and aggregates only (no row contents, no secrets).
 *
 *   npx tsx scripts/deploy-readiness-readonly-probe.ts                       # DATABASE_URL target
 *   npx tsx scripts/phase2-local-copy.ts run scripts/deploy-readiness-readonly-probe.ts
 *
 * Everything runs inside a READ ONLY transaction.
 */
import "../src/loadEnv.js";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { stripeSecretKeyMode } from "../src/utils/stripeKeyMode.js";

if (process.env.NODE_ENV === "production") {
  console.error("[readiness-probe] BLOCKED: NODE_ENV=production");
  process.exit(2);
}
if (stripeSecretKeyMode() === "live") {
  console.error("[readiness-probe] BLOCKED: live Stripe key in environment");
  process.exit(2);
}

const target = process.env.CARETIP_PHASE2_LOCAL_COPY_SCAN === "1" ? "local-copy" : "DATABASE_URL";
const host = (() => {
  try {
    const u = new URL((process.env.DATABASE_URL ?? "").replace(/^postgres(ql)?:\/\//i, "http://"));
    return `${u.hostname}:${u.port || "5432"}`;
  } catch {
    return "(unparseable)";
  }
})();

const TS_COLUMNS: [string, string][] = [
  ["businesses", "kyc_submitted_at"],
  ["employees", "deleted_at"],
  ["stripe_webhook_events", "processed_at"],
  ["user_settings", "created_at"],
  ["user_settings", "updated_at"],
];
const MIGRATIONS = [
  "20261015140000_stripe_webhook_processing_claim",
  "20261015160000_employee_goals_drop_employee_unique_index",
  "20261015170000_phase4_index_tuning",
];
const INDEXES = [
  "employee_goals_employee_id_key",
  "employee_goals_employee_id_idx",
  "employee_goals_employee_id_status_updated_at_idx",
  "tips_business_id_idx",
  "tips_business_id_status_created_at_idx",
  "tips_employee_id_status_payout_status_idx",
  "tips_employee_id_status_created_at_idx",
  "employee_tip_payables_stripe_charge_id_idx",
  "stripe_webhook_events_processed_at_idx",
  "stripe_webhook_events_processing_claim_expires_at_idx",
  "qr_scan_events_dedupe_key_key",
];

const migrationsDir = join(process.cwd(), "prisma", "migrations");
const localMigrations = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(migrationsDir, d.name, "migration.sql")))
  .map((d) => d.name)
  .sort();
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const localChecksum = (name: string) => sha(readFileSync(join(migrationsDir, name, "migration.sql")));
/** Checksum variants: as on disk, LF-normalized, CRLF-normalized (git autocrlf changes bytes, not SQL). */
const localChecksumVariants = (name: string) => {
  const raw = readFileSync(join(migrationsDir, name, "migration.sql"), "utf8");
  const lf = raw.replace(/\r\n/g, "\n");
  return { raw: sha(raw), lf: sha(lf), crlf: sha(lf.replace(/\n/g, "\r\n")) };
};
const checksumKind = (name: string, stored: string): "exact" | "lf" | "crlf" | "content-differs" => {
  const v = localChecksumVariants(name);
  if (stored === v.raw) return "exact";
  if (stored === v.lf) return "lf";
  if (stored === v.crlf) return "crlf";
  return "content-differs";
};

const { prisma } = await import("../src/prisma.js");
console.log(`[readiness-probe] target=${target} host=${host}`);
try {
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const ro = await tx.$queryRaw<{ ro: string }[]>`SELECT current_setting('transaction_read_only') AS ro`;
      if (ro[0]?.ro !== "on") throw new Error("transaction is not read-only");
      const env = await tx.$queryRaw<{ tz: string; ver: string }[]>`
        SELECT current_setting('TimeZone') AS tz, current_setting('server_version') AS ver`;
      const roleTz = await tx.$queryRaw<{ scope: string; c: string }[]>`
        SELECT CASE WHEN s.setrole = 0 THEN 'database' WHEN s.setdatabase = 0 THEN 'role' ELSE 'role+database' END AS scope, c
        FROM pg_db_role_setting s CROSS JOIN LATERAL unnest(s.setconfig) c
        WHERE lower(c) LIKE 'timezone=%'
          AND (s.setdatabase IN (0, (SELECT oid FROM pg_database WHERE datname = current_database())))
          AND (s.setrole IN (0, (SELECT oid FROM pg_roles WHERE rolname = current_user)))`;
      console.log(
        `  read_only=on session TimeZone=${env[0]?.tz} server=${env[0]?.ver} overrides=${roleTz.map((r) => `${r.scope}:${r.c}`).join(",") || "(none)"}`,
      );

      console.log("\n== timestamp columns ==");
      for (const [table, column] of TS_COLUMNS) {
        const c = (
          await tx.$queryRaw<{ data_type: string; precision: number | null; nullable: string; def: string | null }[]>`
            SELECT data_type, datetime_precision AS precision, is_nullable AS nullable, column_default AS def
            FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}`
        )[0];
        if (!c) {
          console.log(`  ${table}.${column}: MISSING`);
          continue;
        }
        const stats = (
          await tx.$queryRawUnsafe<{ n: bigint; nn: bigint; min: string | null; max: string | null }[]>(
            `SELECT COUNT(*) AS n, COUNT("${column}") AS nn, MIN("${column}")::text AS min, MAX("${column}")::text AS max FROM "${table}"`,
          )
        )[0];
        console.log(
          `  ${table}.${column}: ${c.data_type}(${c.precision}) nullable=${c.nullable} default=${c.def ?? "none"} rows=${stats?.n} non_null=${stats?.nn} min=${stats?.min ?? "-"} max=${stats?.max ?? "-"}`,
        );
      }
      const tzCols = await tx.$queryRaw<{ t: string; c: string }[]>`
        SELECT table_name AS t, column_name AS c FROM information_schema.columns
        WHERE table_schema = 'public' AND data_type = 'timestamp with time zone' ORDER BY 1, 2`;
      const plainCols = await tx.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(*) AS n FROM information_schema.columns
        WHERE table_schema = 'public' AND data_type = 'timestamp without time zone'`;
      console.log(`  all timestamptz columns in public: ${tzCols.length ? tzCols.map((r) => `${r.t}.${r.c}`).join(", ") : "none"}`);
      console.log(`  timestamp-without-tz columns in public: ${plainCols[0]?.n}`);

      const us = await tx.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM user_settings WHERE updated_at < created_at`;
      console.log(`  user_settings rows with updated_at < created_at: ${us[0]?.n}`);
      const trig = await tx.$queryRaw<{ name: string; def: string }[]>`
        SELECT p.proname AS name, pg_get_functiondef(p.oid) AS def FROM pg_proc p
        WHERE p.proname = 'user_settings_set_updated_at_fn'`;
      const trigOn = await tx.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(*) AS n FROM pg_trigger WHERE tgname = 'user_settings_set_updated_at' AND NOT tgisinternal`;
      console.log(
        `  user_settings trigger present=${Number(trigOn[0]?.n ?? 0) > 0} fn uses NOW()=${/now\(\)/i.test(trig[0]?.def ?? "")}`,
      );

      const deps = await tx.$queryRaw<{ obj: string; kind: string; tbl: string }[]>`
        SELECT DISTINCT v.relname AS obj, v.relkind::text AS kind, t.relname AS tbl
        FROM pg_depend d JOIN pg_rewrite r ON r.oid = d.objid JOIN pg_class v ON v.oid = r.ev_class
        JOIN pg_class t ON t.oid = d.refobjid
        WHERE t.relname IN ('businesses','employees','stripe_webhook_events','user_settings') AND v.oid <> t.oid`;
      console.log(`  views/rules depending on these tables: ${deps.length ? deps.map((d) => `${d.obj}(${d.kind})->${d.tbl}`).join(", ") : "none"}`);
      const colIdx = await tx.$queryRaw<{ idx: string; tbl: string; def: string }[]>`
        SELECT i.indexname AS idx, i.tablename AS tbl, i.indexdef AS def FROM pg_indexes i
        WHERE i.schemaname = 'public' AND (
          (i.tablename = 'businesses' AND i.indexdef LIKE '%kyc_submitted_at%') OR
          (i.tablename = 'employees' AND i.indexdef LIKE '%deleted_at%') OR
          (i.tablename = 'stripe_webhook_events' AND i.indexdef LIKE '%processed_at%') OR
          (i.tablename = 'user_settings' AND (i.indexdef LIKE '%created_at%' OR i.indexdef LIKE '%updated_at%')))`;
      console.log(`  indexes on drift columns: ${colIdx.map((r) => r.idx).join(", ") || "none"}`);
      const sizes = await tx.$queryRaw<{ t: string; est: number; bytes: bigint }[]>`
        SELECT c.relname AS t, c.reltuples::float8 AS est, pg_total_relation_size(c.oid) AS bytes FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname IN ('businesses','employees','stripe_webhook_events','user_settings') ORDER BY 1`;
      for (const s of sizes) console.log(`  size ${s.t}: ~${Math.max(0, Math.round(s.est))} rows, ${(Number(s.bytes) / 1024).toFixed(0)} KiB`);

      console.log("\n== migration history ==");
      const hasTable = (await tx.$queryRaw<{ ok: boolean }[]>`SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS ok`)[0]?.ok;
      if (!hasTable) console.log("  _prisma_migrations: absent");
      else {
        const rows = await tx.$queryRaw<
          { name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null; steps: number; logs: string | null }[]
        >`SELECT migration_name AS name, checksum, finished_at, rolled_back_at, applied_steps_count AS steps, logs FROM _prisma_migrations`;
        const applied = rows.filter((r) => r.finished_at && !r.rolled_back_at);
        const appliedNames = new Set(applied.map((r) => r.name));
        const failed = rows.filter((r) => !r.finished_at && !r.rolled_back_at);
        const rolledBack = rows.filter((r) => r.rolled_back_at);
        console.log(`  rows=${rows.length} applied=${applied.length} failed/in-progress=${failed.length} rolled_back=${rolledBack.length} local_dirs=${localMigrations.length}`);
        for (const r of failed) console.log(`    FAILED/IN-PROGRESS ${r.name}`);
        for (const r of rolledBack) console.log(`    rolled back ${r.name}`);
        const notApplied = localMigrations.filter((m) => !appliedNames.has(m));
        const notLocal = [...appliedNames].filter((m) => !localMigrations.includes(m));
        console.log(`  local not applied: ${notApplied.join(", ") || "none"}`);
        console.log(`  applied but not in repo: ${notLocal.join(", ") || "none"}`);
        const kinds = applied
          .filter((r) => localMigrations.includes(r.name))
          .map((r) => ({ name: r.name, kind: checksumKind(r.name, r.checksum) }));
        const tally = kinds.reduce<Record<string, number>>((a, k) => ((a[k.kind] = (a[k.kind] ?? 0) + 1), a), {});
        console.log(`  applied checksum vs repo file: ${Object.entries(tally).map(([k, n]) => `${k}=${n}`).join(" ")}`);
        const differs = kinds.filter((k) => k.kind === "content-differs").map((k) => k.name);
        console.log(`  content differs even after line-ending normalization: ${differs.join(", ") || "none"}`);
        for (const m of MIGRATIONS) {
          const r = rows.find((x) => x.name === m);
          const local = localMigrations.includes(m);
          console.log(
            `  ${m}: ${r ? `applied finished_at=${r.finished_at?.toISOString() ?? "null"} steps=${r.steps} checksum=${local ? checksumKind(m, r.checksum) : "no local file"}` : "NOT APPLIED"}${local ? ` repo_raw_sha=${localChecksum(m).slice(0, 12)}` : ""}`,
          );
          const blob = spawnSync("git", ["show", `:backend/prisma/migrations/${m}/migration.sql`], { cwd: join(process.cwd(), ".."), maxBuffer: 1 << 20 });
          console.log(
            `    git index blob: ${blob.status === 0 ? `staged, sha=${sha(blob.stdout).slice(0, 12)} == applied checksum: ${r ? sha(blob.stdout) === r.checksum : "n/a"}` : "not in index"}`,
          );
        }
      }

      console.log("\n== indexes ==");
      const idx = await tx.$queryRaw<{ name: string; def: string; scans: bigint | null }[]>`
        SELECT i.indexname AS name, i.indexdef AS def, s.idx_scan AS scans
        FROM pg_indexes i LEFT JOIN pg_stat_user_indexes s ON s.indexrelname = i.indexname AND s.schemaname = i.schemaname
        WHERE i.schemaname = 'public' AND i.indexname = ANY(${INDEXES})`;
      for (const name of INDEXES) {
        const r = idx.find((x) => x.name === name);
        console.log(`  ${name}: ${r ? `present${/UNIQUE/.test(r.def) ? " UNIQUE" : ""} idx_scan=${r.scans ?? "n/a"}` : "absent"}`);
      }
      const claimCols = await tx.$queryRaw<{ c: string }[]>`
        SELECT column_name AS c FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'stripe_webhook_events'
          AND column_name IN ('processing_result','processing_claim_token','processing_claim_expires_at','processing_error') ORDER BY 1`;
      console.log(`  webhook claim columns: ${claimCols.map((r) => r.c).join(", ") || "none"}`);
      const onboardingCol = await tx.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(*) AS n FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'has_completed_onboarding'`;
      console.log(`  User.has_completed_onboarding (edited 20260529120000): ${Number(onboardingCol[0]?.n ?? 0) > 0 ? "present" : "absent"}`);
      console.log("\n== transition-window tips (backfill candidates) ==");
      for (const tipId of ["cmtvejz87000rif3q6ikpficc", "cmtvekj1p000zif3q1hnlnfsj"]) {
        const t = (
          await tx.$queryRaw<{ status: string; amount: string; payables: bigint; disputes: string | null }[]>`
            SELECT t.status::text AS status, t.amount::text AS amount,
              (SELECT COUNT(*) FROM employee_tip_payables p WHERE p.transaction_id = t.id) AS payables,
              (SELECT string_agg(r.kind::text || '/' || r.status::text || '/' || r.amount_eur::text, ',') FROM tip_refunds r WHERE r.tip_id = t.id) AS disputes
            FROM tips t WHERE t.id = ${tipId}`
        )[0];
        console.log(`  ${tipId}: ${t ? `tip=${t.status} amount=${t.amount} payable_rows=${t.payables} tip_refunds=${t.disputes ?? "none"}` : "NOT FOUND"}`);
      }

      const goalDupes = await tx.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(*) AS n FROM (SELECT employee_id FROM employee_goals GROUP BY employee_id HAVING COUNT(*) > 1) d`;
      console.log(`  employees with >1 goal (rollback of 160000 would fail if >0): ${goalDupes[0]?.n}`);
    },
    { timeout: 60_000 },
  );
} finally {
  await prisma.$disconnect().catch(() => undefined);
}
