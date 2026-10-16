/**
 * Phase 2 sanitized local validation copy of the shared development database.
 *
 *   npx tsx scripts/phase2-local-copy.ts preflight   read-only metadata checks; copies nothing
 *   npx tsx scripts/phase2-local-copy.ts copy        snapshot -> sanitize in flight -> local cluster
 *   npx tsx scripts/phase2-local-copy.ts manifest    recompute the fixture manifest (read-only) and compare
 *   npx tsx scripts/phase2-local-copy.ts scan        integrity scan against the local copy only
 *   npx tsx scripts/phase2-local-copy.ts run <scripts/x.ts>   run another script against the local copy
 *
 * `copy` and `manifest` read personal data from the source and require
 * CARETIP_PHASE2_LOCAL_COPY_AUTHORIZED=<source fingerprint printed by preflight>.
 * The source is only read inside a REPEATABLE READ, READ ONLY transaction. Raw personal data is never
 * written anywhere: rows are sanitized in memory before the INSERT into the loopback cluster.
 * Output: counts, internal ids and labels only; local artifacts live outside the repository.
 */
import "../src/loadEnv.js";
import { Prisma, PrismaClient } from "@prisma/client";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, statfsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyBusiness, classifyRecord, type BusinessClassification } from "./lib/phase2FixtureClassification.js";
import { PHASE2_LOCAL_DB, phase2StateDir, startPhase2LocalCluster } from "./lib/phase2LocalCluster.js";
import { columnPolicy, createSanitizer, SANITIZER_VERSION, type ColumnInfo, type ColumnPolicy } from "./lib/phase2Sanitizer.js";
import { stripeSecretKeyMode } from "../src/utils/stripeKeyMode.js";

const backendRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const AUTH_ENV = "CARETIP_PHASE2_LOCAL_COPY_AUTHORIZED";
const BATCH = 1000;
const mode = process.argv[2] ?? "preflight";

function blocked(reason: string): never {
  console.error(`[phase2-local-copy] BLOCKED: ${reason}`);
  process.exit(2);
}

function parseUrl(url: string): URL {
  return new URL(url.replace(/^postgres(ql)?:\/\//i, "http://"));
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

if (process.env.NODE_ENV === "production") blocked("NODE_ENV=production");

// ---------------------------------------------------------------- source identity
const sourceUrl = process.env.DATABASE_URL?.trim() ?? "";
if (!sourceUrl) blocked("DATABASE_URL (source) is unset");
const src = parseUrl(sourceUrl);
const sourceHost = `${src.hostname}:${src.port || "5432"}`;
const sourceFingerprint = createHash("sha256")
  .update(`${src.hostname}|${src.port || "5432"}|${src.pathname}|${decodeURIComponent(src.username)}`)
  .digest("hex")
  .slice(0, 16);
if (LOOPBACK.has(src.hostname)) blocked("source DATABASE_URL is loopback; expected the shared development database");

const { prisma: source } = await import("../src/prisma.js");

type TableMeta = { name: string; columns: ColumnInfo[]; pk: string[] };

async function readLocalSchema(db: PrismaClient): Promise<TableMeta[]> {
  const cols = await db.$queryRaw<
    { table_name: string; column_name: string; data_type: string; udt_name: string; max_len: number | null; is_nullable: string }[]
  >`SELECT c.table_name, c.column_name, c.data_type, c.udt_name, c.character_maximum_length AS max_len, c.is_nullable
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND c.table_name NOT LIKE '\_caretip\_%'
    ORDER BY c.table_name, c.ordinal_position`;
  const pks = await db.$queryRaw<{ table_name: string; column_name: string }[]>`
    SELECT tc.table_name, kcu.column_name FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema AND kcu.table_name = tc.table_name
    WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'`;
  const fks = await db.$queryRaw<{ table_name: string; column_name: string }[]>`
    SELECT cl.relname AS table_name, a.attname AS column_name FROM pg_constraint c
    JOIN pg_class cl ON cl.oid = c.conrelid JOIN pg_namespace n ON n.oid = cl.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.contype = 'f' AND n.nspname = 'public'`;
  const pkSet = new Set(pks.map((r) => `${r.table_name}.${r.column_name}`));
  const fkSet = new Set(fks.map((r) => `${r.table_name}.${r.column_name}`));
  const tables = new Map<string, TableMeta>();
  for (const c of cols) {
    const t = tables.get(c.table_name) ?? { name: c.table_name, columns: [], pk: [] };
    const key = `${c.table_name}.${c.column_name}`;
    t.columns.push({
      table: c.table_name,
      column: c.column_name,
      dataType: c.data_type,
      udtName: c.udt_name,
      maxLength: c.max_len == null ? null : Number(c.max_len),
      nullable: c.is_nullable === "YES",
      isPk: pkSet.has(key),
      isFk: fkSet.has(key),
    });
    if (pkSet.has(key)) t.pk.push(c.column_name);
    tables.set(c.table_name, t);
  }
  return [...tables.values()];
}

function repoMigrationNames(): string[] {
  return readdirSync(join(backendRoot, "prisma", "migrations"), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

type Preflight = {
  dbBytes: number;
  publicBytes: number;
  tableCounts: Map<string, number>;
  appliedMigrations: string[];
};

/** Read-only, metadata/count-only checks. Throws/blocks on any safety failure. */
async function preflight(): Promise<Preflight> {
  console.log("[phase2-local-copy] preflight (read-only; no rows copied)");
  console.log(`  source host: ${sourceHost} (credentials not printed)`);
  console.log(`  source fingerprint: ${sourceFingerprint}`);
  console.log(`  stripe key mode (for later scan): ${stripeSecretKeyMode()}`);
  const out = await source.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const ro = await tx.$queryRaw<{ ro: string }[]>`SELECT current_setting('transaction_read_only') AS ro`;
      if (ro[0]?.ro !== "on") throw new Error("source transaction is not read-only");
      const role = await tx.$queryRaw<{ su: boolean; cr: boolean; cd: boolean; br: boolean }[]>`
        SELECT rolsuper AS su, rolcreaterole AS cr, rolcreatedb AS cd, rolbypassrls AS br
        FROM pg_roles WHERE rolname = current_user`;
      const size = await tx.$queryRaw<{ db: bigint; pub: bigint }[]>`
        SELECT pg_database_size(current_database())::bigint AS db,
               COALESCE(SUM(pg_total_relation_size(c.oid)), 0)::bigint AS pub
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'`;
      const migrations = await tx.$queryRaw<{ migration_name: string }[]>`
        SELECT migration_name FROM _prisma_migrations
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`;
      const tables = await tx.$queryRaw<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`;
      const tableCounts = new Map<string, number>();
      for (const { table_name } of tables) {
        const n = await tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(*)::bigint AS n FROM "public"."${table_name}"`);
        tableCounts.set(table_name, Number(n[0]?.n ?? 0));
      }
      const r = role[0];
      console.log(
        `  source role: superuser=${r?.su} createrole=${r?.cr} createdb=${r?.cd} bypassrls=${r?.br} ` +
          "(the app role; writes are prevented by the server-enforced READ ONLY transaction)",
      );
      return {
        dbBytes: Number(size[0]?.db ?? 0),
        publicBytes: Number(size[0]?.pub ?? 0),
        tableCounts,
        appliedMigrations: migrations.map((m) => m.migration_name),
      };
    },
    { timeout: 300_000, maxWait: 30_000 },
  );

  const repo = repoMigrationNames();
  const missingLocally = out.appliedMigrations.filter((m) => !repo.includes(m));
  const notOnSource = repo.filter((m) => !out.appliedMigrations.includes(m));
  console.log(`  source: database ${(out.dbBytes / 1e6).toFixed(1)} MB, public tables ${(out.publicBytes / 1e6).toFixed(1)} MB, ${out.tableCounts.size} tables, ${[...out.tableCounts.values()].reduce((a, b) => a + b, 0)} rows`);
  console.log(`  migrations: source applied ${out.appliedMigrations.length}, repo ${repo.length}, source-only ${missingLocally.length}, repo-only ${notOnSource.length}`);
  if (missingLocally.length || notOnSource.length) {
    for (const m of [...missingLocally, ...notOnSource]) console.log(`    differs: ${m}`);
    blocked("source migration history differs from the repository; schema-faithful restore not possible");
  }

  mkdirSync(phase2StateDir(), { recursive: true });
  const fs = statfsSync(phase2StateDir());
  const free = Number(fs.bavail) * Number(fs.bsize);
  const needed = out.publicBytes * 3 + 400e6;
  console.log(`  local disk free: ${(free / 1e9).toFixed(2)} GB, required (3x public data + cluster): ${(needed / 1e9).toFixed(2)} GB`);
  if (free < needed) blocked("insufficient local disk space");
  console.log(`  destination: embedded PostgreSQL 127.0.0.1 (loopback only), database ${PHASE2_LOCAL_DB}`);
  console.log(`  destination data dir: ${join(phase2StateDir(), "pgdata")} (outside the repository)`);
  console.log("  copy method: streamed logical snapshot, sanitized in memory before INSERT (no raw dump file)");
  return out;
}

// ---------------------------------------------------------------- manifest
type ManifestRow = BusinessClassification & { tips: number; payables: number };
type Manifest = {
  rows: ManifestRow[];
  inconclusiveRecords: { id: string; table: string; businessId: string | null; reason: string }[];
  sha: string;
};

async function buildManifest(tx: Prisma.TransactionClient): Promise<Manifest> {
  const businesses = await tx.$queryRaw<
    { id: string; slug: string; created_at: Date; stripe_account_id: string | null; email: string | null }[]
  >`SELECT b.id, b.slug, b.created_at, b.stripe_account_id, u.email
    FROM businesses b LEFT JOIN "User" u ON u.id = b.user_id ORDER BY b.id`;
  const counts = await tx.$queryRaw<{ business_id: string; tips: bigint; payables: bigint }[]>`
    SELECT b.id AS business_id,
      (SELECT COUNT(*) FROM tips t WHERE t.business_id = b.id)::bigint AS tips,
      (SELECT COUNT(*) FROM employee_tip_payables p WHERE p.business_id = b.id)::bigint AS payables
    FROM businesses b`;
  const countBy = new Map(counts.map((c) => [c.business_id, c]));
  const forClass = new Map(
    businesses.map((b) => [
      b.id,
      { id: b.id, slug: b.slug, createdAt: b.created_at, stripeAccountId: b.stripe_account_id, managerEmail: b.email },
    ]),
  );
  const rows: ManifestRow[] = businesses.map((b) => ({
    ...classifyBusiness(forClass.get(b.id)!),
    tips: Number(countBy.get(b.id)?.tips ?? 0),
    payables: Number(countBy.get(b.id)?.payables ?? 0),
  }));
  const inScope = new Set(rows.filter((r) => r.class === "non-fixture" || r.class === "test-mode-real-format").map((r) => r.businessId));
  const records = await tx.$queryRaw<
    { id: string; tbl: string; business_id: string; pi: string | null; tr: string | null; tip_id: string | null }[]
  >`SELECT t.id, 'tips' AS tbl, t.business_id, t.stripe_payment_intent_id AS pi, NULL::text AS tr, t.id AS tip_id FROM tips t
    WHERE t.business_id = ANY(${[...inScope]}::text[])
    UNION ALL
    SELECT p.id, 'employee_tip_payables', p.business_id, p.stripe_payment_intent_id, p.stripe_transfer_id, p.transaction_id
    FROM employee_tip_payables p WHERE p.business_id = ANY(${[...inScope]}::text[])`;
  const inconclusiveRecords: Manifest["inconclusiveRecords"] = [];
  for (const r of records) {
    const c = classifyRecord({ business: forClass.get(r.business_id) ?? null, paymentIntentId: r.pi, transferId: r.tr, tipId: r.tip_id });
    if (c.classification === "inconclusive" || c.classification === "probable fixture") {
      inconclusiveRecords.push({ id: r.id, table: r.tbl, businessId: r.business_id, reason: `${c.classification}: ${c.reason}` });
    }
  }
  const canonical = JSON.stringify(
    rows.map((r) => [r.businessId, r.class, r.suite, r.account, r.managerEmail]).concat(
      inconclusiveRecords.map((r) => [r.id, r.table, r.reason]),
    ),
  );
  return { rows, inconclusiveRecords, sha: createHash("sha256").update(canonical).digest("hex").slice(0, 16) };
}

function printManifest(m: Manifest) {
  const by = new Map<string, ManifestRow[]>();
  for (const r of m.rows) by.set(r.class, [...(by.get(r.class) ?? []), r]);
  console.log(`  manifest sha: ${m.sha}`);
  for (const [cls, list] of [...by.entries()].sort()) {
    const withPayables = list.filter((r) => r.payables > 0).length;
    console.log(`  ${cls}: ${list.length} businesses (${withPayables} with payables, tips ${list.reduce((a, r) => a + r.tips, 0)}, payables ${list.reduce((a, r) => a + r.payables, 0)})`);
  }
  for (const r of m.rows.filter((x) => x.class === "test-mode-real-format")) {
    console.log(`    real-format: ${r.businessId} tips=${r.tips} payables=${r.payables} (${r.evidence})`);
  }
  console.log(`  in-scope records not cleared as legitimate: ${m.inconclusiveRecords.length}`);
  for (const r of m.inconclusiveRecords.slice(0, 20)) console.log(`    ${r.table} ${r.id} biz=${r.businessId} ${r.reason}`);
}

function requireAuthorization() {
  const value = process.env[AUTH_ENV]?.trim();
  if (value !== sourceFingerprint) {
    blocked(
      `${AUTH_ENV} must equal the source fingerprint (${sourceFingerprint}) to authorize reading personal data from this source.`,
    );
  }
}

// ---------------------------------------------------------------- copy
type IndexInfo = { name: string; table: string; unique: boolean; conname: string | null; shape: string };

async function readIndexes(db: Prisma.TransactionClient | PrismaClient): Promise<IndexInfo[]> {
  const rows = await db.$queryRaw<{ name: string; tbl: string; uniq: boolean; conname: string | null; def: string }[]>`
    SELECT ic.relname AS name, tc.relname AS tbl, i.indisunique AS uniq, con.conname, pg_get_indexdef(i.indexrelid) AS def
    FROM pg_index i
    JOIN pg_class ic ON ic.oid = i.indexrelid
    JOIN pg_class tc ON tc.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = tc.relnamespace
    LEFT JOIN pg_constraint con ON con.conindid = i.indexrelid AND con.contype IN ('p', 'u', 'x')
    WHERE n.nspname = 'public'`;
  return rows.map((r) => ({
    name: r.name,
    table: r.tbl,
    unique: r.uniq,
    conname: r.conname,
    shape: r.def.replace(/INDEX \S+ ON/, "INDEX ON"),
  }));
}

async function verifyLocalTarget(db: PrismaClient, dataDir: string) {
  const r = await db.$queryRaw<{ addr: string | null; dir: string; dbname: string }[]>`
    SELECT inet_server_addr()::text AS addr, current_setting('data_directory') AS dir, current_database() AS dbname`;
  const addr = r[0]?.addr?.split("/")[0] ?? "";
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  if (addr !== "127.0.0.1" && addr !== "::1") blocked("local target is not loopback");
  if (norm(r[0]?.dir ?? "") !== norm(dataDir)) blocked("local target is not the Phase 2 cluster");
  if (r[0]?.dbname !== PHASE2_LOCAL_DB) blocked("unexpected local database name");
}

async function copy() {
  const pre = await preflight();
  requireAuthorization();
  const cluster = await startPhase2LocalCluster();
  const admin = new PrismaClient({ datasources: { db: { url: cluster.adminUrl } }, log: ["error"] });
  let local: PrismaClient | null = null;
  try {
    if (!LOOPBACK.has(parseUrl(cluster.adminUrl).hostname)) blocked("cluster URL is not loopback");
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${PHASE2_LOCAL_DB} WITH (FORCE)`);
    await admin.$executeRawUnsafe(`CREATE DATABASE ${PHASE2_LOCAL_DB}`);
    await admin.$disconnect();

    console.log("[phase2-local-copy] applying repository migrations to the local copy database");
    const migrate = spawnSync("npx", ["prisma", "migrate", "deploy"], {
      cwd: backendRoot,
      env: { ...process.env, DATABASE_URL: cluster.connectionUrl },
      stdio: ["ignore", "ignore", "inherit"],
      shell: true,
    });
    if (migrate.status !== 0) throw new Error("prisma migrate deploy failed on the local copy");

    local = new PrismaClient({ datasources: { db: { url: cluster.connectionUrl } }, log: ["error"] });
    await verifyLocalTarget(local, cluster.databaseDir);
    const tables = await readLocalSchema(local);
    const sanitizer = createSanitizer(randomBytes(32));
    const policyCounts = new Map<ColumnPolicy, number>();
    const policyByColumn: Record<string, ColumnPolicy> = {};
    for (const t of tables) {
      for (const c of t.columns) {
        const p = columnPolicy(c);
        policyByColumn[`${t.name}.${c.column}`] = p;
        policyCounts.set(p, (policyCounts.get(p) ?? 0) + 1);
      }
    }

    const copied = new Map<string, number>();
    const sourceCounts = new Map<string, number>();
    const schemaDrift: string[] = [];
    const db = local;
    const manifest = await source.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        const iso = await tx.$queryRaw<{ ro: string; iso: string }[]>`
          SELECT current_setting('transaction_read_only') AS ro, current_setting('transaction_isolation') AS iso`;
        if (iso[0]?.ro !== "on" || iso[0]?.iso !== "repeatable read") throw new Error("source snapshot is not REPEATABLE READ, READ ONLY");
        console.log("[phase2-local-copy] source snapshot: REPEATABLE READ, READ ONLY");

        const srcCols = await tx.$queryRaw<{ table_name: string; column_name: string; data_type: string }[]>`
          SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public'`;
        const srcType = new Map(srcCols.map((c) => [`${c.table_name}.${c.column_name}`, c.data_type]));
        const castable = new Set(["timestamp without time zone>timestamp with time zone", "timestamp with time zone>timestamp without time zone"]);
        const blockingDrift: string[] = [];
        const localTables = new Set(tables.map((t) => t.name));
        for (const t of tables) {
          for (const c of t.columns) {
            const key = `${t.name}.${c.column}`;
            const st = srcType.get(key);
            if (st === c.dataType) continue;
            if (st && castable.has(`${st}>${c.dataType}`)) {
              schemaDrift.push(`${key}: source ${st}, repository ${c.dataType} (copied via UTC cast)`);
            } else {
              blockingDrift.push(`${key}: source ${st ?? "missing"}, repository ${c.dataType}`);
            }
          }
        }
        for (const d of schemaDrift) console.log(`  SCHEMA DRIFT (non-blocking) ${d}`);
        if (blockingDrift.length) {
          for (const d of blockingDrift) console.log(`  SCHEMA DRIFT (blocking) ${d}`);
          throw new Error(`blocking column drift on ${blockingDrift.length} column(s)`);
        }
        const localCols = new Set(tables.flatMap((t) => t.columns.map((c) => `${t.name}.${c.column}`)));
        const sourceOnlyCols = [...srcType.keys()].filter((k) => !localCols.has(k) && tables.some((t) => k.startsWith(`${t.name}.`)));
        for (const k of sourceOnlyCols) {
          schemaDrift.push(`${k}: source-only column, not copied`);
          console.log(`  SCHEMA DRIFT (non-blocking) ${k}: source-only column, not copied`);
        }

        const srcIdx = await readIndexes(tx);
        const localIdx = await readIndexes(db);
        const srcDefs = new Set(srcIdx.map((i) => i.shape));
        const localDefs = new Set(localIdx.map((i) => i.shape));
        for (const i of localIdx) {
          if (srcDefs.has(i.shape)) continue;
          if (i.unique) {
            await db.$executeRawUnsafe(
              i.conname
                ? `ALTER TABLE "public"."${i.table}" DROP CONSTRAINT "${i.conname}"`
                : `DROP INDEX "public"."${i.name}"`,
            );
            schemaDrift.push(`${i.table}: repository unique index ${i.name} absent in source (dropped on local copy to mirror source)`);
            console.log(`  SCHEMA DRIFT (non-blocking) ${i.table}: repository unique index ${i.name} absent in source; dropped on local copy`);
          } else {
            schemaDrift.push(`${i.table}: repository index ${i.name} absent in source (kept on local copy)`);
            console.log(`  SCHEMA DRIFT (non-blocking) ${i.table}: repository index ${i.name} absent in source; kept on local copy`);
          }
        }
        for (const i of srcIdx) {
          if (localDefs.has(i.shape) || !localTables.has(i.table)) continue;
          schemaDrift.push(`${i.table}: source-only index ${i.name}${i.unique ? " (unique)" : ""}`);
          console.log(`  SCHEMA DRIFT (non-blocking) ${i.table}: source-only index ${i.name}${i.unique ? " (unique)" : ""}`);
        }
        const sourceOnly = [...pre.tableCounts.keys()].filter((t) => !localTables.has(t));
        if (sourceOnly.length) console.log(`  source-only tables not copied: ${sourceOnly.join(", ")}`);

        const m = await buildManifest(tx);
        await db.$executeRawUnsafe(`DELETE FROM "_prisma_migrations"`);
        const copyTables = tables.filter((t) => t.name !== "_prisma_migrations");
        for (const t of copyTables) {
          const seeded = Number((await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(*)::bigint AS n FROM "public"."${t.name}"`))[0]?.n ?? 0);
          if (seeded > 0) console.log(`  local migration-seeded rows replaced by source rows: ${t.name} (${seeded})`);
        }
        await db.$executeRawUnsafe(`TRUNCATE TABLE ${copyTables.map((t) => `"public"."${t.name}"`).join(", ")}`);

        for (const t of tables) {
          const n = Number((await tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(*)::bigint AS n FROM "public"."${t.name}"`))[0]?.n ?? 0);
          sourceCounts.set(t.name, n);
          const selectList = t.columns
            .map((c) =>
              c.dataType === "bigint" || c.dataType === "numeric" ? `"${c.column}"::text AS "${c.column}"` : `"${c.column}"`,
            )
            .join(", ");
          let done = 0;
          for (let offset = 0; offset < n; offset += BATCH) {
            const rows = await tx.$queryRawUnsafe<{ j: string }[]>(
              `SELECT row_to_json(x)::text AS j FROM (SELECT ${selectList} FROM "public"."${t.name}" ORDER BY ctid LIMIT ${BATCH} OFFSET ${offset}) x`,
            );
            const clean = rows.map(({ j }) => {
              const raw = JSON.parse(j) as Record<string, unknown>;
              const out: Record<string, unknown> = {};
              for (const c of t.columns) out[c.column] = sanitizer.sanitizeValue(c, policyByColumn[`${t.name}.${c.column}`], raw[c.column]);
              return out;
            });
            await db
              .$transaction(async (ltx) => {
                await ltx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
                await ltx.$executeRawUnsafe(
                  `INSERT INTO "public"."${t.name}" SELECT * FROM json_populate_recordset(NULL::"public"."${t.name}", $1::json)`,
                  JSON.stringify(clean),
                );
              }, { timeout: 120_000 })
              .catch((e: unknown) => {
                throw new Error(`insert into ${t.name} (rows ${offset}..${offset + clean.length}) failed: ${(e as Error).message}`);
              });
            done += clean.length;
          }
          copied.set(t.name, done);
        }
        return m;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 3_600_000, maxWait: 30_000 },
    );

    // ---- validation
    let countMismatch = 0;
    for (const t of tables) {
      const n = Number((await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(*)::bigint AS n FROM "public"."${t.name}"`))[0]?.n ?? 0);
      if (n !== sourceCounts.get(t.name) || n !== copied.get(t.name)) {
        countMismatch += 1;
        console.log(`  COUNT MISMATCH ${t.name}: source ${sourceCounts.get(t.name)} copied ${copied.get(t.name)} local ${n}`);
      }
    }
    const fks = await db.$queryRaw<{ conname: string; child: string; parent: string; ccols: string[]; pcols: string[] }[]>`
      SELECT c.conname, cl.relname AS child, pl.relname AS parent,
        array_agg(ca.attname::text ORDER BY k.ord) AS ccols, array_agg(pa.attname::text ORDER BY k.ord) AS pcols
      FROM pg_constraint c
      JOIN pg_class cl ON cl.oid = c.conrelid JOIN pg_namespace n ON n.oid = cl.relnamespace
      JOIN pg_class pl ON pl.oid = c.confrelid
      CROSS JOIN LATERAL unnest(c.conkey, c.confkey) WITH ORDINALITY AS k(ck, pk, ord)
      JOIN pg_attribute ca ON ca.attrelid = c.conrelid AND ca.attnum = k.ck
      JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = k.pk
      WHERE c.contype = 'f' AND n.nspname = 'public'
      GROUP BY c.conname, cl.relname, pl.relname`;
    let orphanTotal = 0;
    for (const fk of fks) {
      const notNull = fk.ccols.map((c) => `c."${c}" IS NOT NULL`).join(" AND ");
      const join = fk.ccols.map((c, i) => `p."${fk.pcols[i]}" = c."${c}"`).join(" AND ");
      const orphans = Number(
        (await db.$queryRawUnsafe<{ n: bigint }[]>(
          `SELECT COUNT(*)::bigint AS n FROM "public"."${fk.child}" c WHERE ${notNull}
           AND NOT EXISTS (SELECT 1 FROM "public"."${fk.parent}" p WHERE ${join})`,
        ))[0]?.n ?? 0,
      );
      if (orphans > 0) console.log(`  FK ORPHANS ${fk.conname}: ${orphans}`);
      orphanTotal += orphans;
    }
    let residualEmails = 0;
    for (const t of tables) {
      for (const c of t.columns) {
        const p = policyByColumn[`${t.name}.${c.column}`];
        if (!["text", "character varying", "json", "jsonb", "ARRAY"].includes(c.dataType)) continue;
        const n = Number(
          (await db.$queryRawUnsafe<{ n: bigint }[]>(
            `SELECT COUNT(*)::bigint AS n FROM "public"."${t.name}"
             WHERE "${c.column}"::text ~* '[a-z0-9._%+-]+@(?!example\\.invalid)[a-z0-9-]+(\\.[a-z0-9-]+)*\\.[a-z]{2,}'`,
          ))[0]?.n ?? 0,
        );
        if (n > 0) console.log(`  RESIDUAL EMAIL-LIKE VALUES ${t.name}.${c.column} (${p}): ${n}`);
        residualEmails += n;
      }
    }

    await db.$executeRawUnsafe(`CREATE TABLE "_caretip_phase2_manifest" (business_id text PRIMARY KEY, class text NOT NULL, suite text, evidence text NOT NULL, account_shape text NOT NULL, manager_email_class text NOT NULL)`);
    await db.$executeRawUnsafe(
      `INSERT INTO "_caretip_phase2_manifest" SELECT * FROM json_to_recordset($1::json) AS x(business_id text, class text, suite text, evidence text, account_shape text, manager_email_class text)`,
      JSON.stringify(manifest.rows.map((r) => ({ business_id: r.businessId, class: r.class, suite: r.suite, evidence: r.evidence, account_shape: r.account, manager_email_class: r.managerEmail }))),
    );
    await db.$executeRawUnsafe(`CREATE TABLE "_caretip_phase2_copy" (key text PRIMARY KEY, value text NOT NULL)`);
    const meta = {
      copied_at: new Date().toISOString(),
      source_fingerprint: sourceFingerprint,
      sanitizer_version: SANITIZER_VERSION,
      manifest_sha: manifest.sha,
      inconclusive_records: JSON.stringify(manifest.inconclusiveRecords.map((r) => r.id)),
    };
    for (const [key, value] of Object.entries(meta)) {
      await db.$executeRaw`INSERT INTO "_caretip_phase2_copy" (key, value) VALUES (${key}, ${value})`;
    }

    const report = {
      ...meta,
      tables: tables.length,
      rows: [...copied.values()].reduce((a, b) => a + b, 0),
      countMismatchTables: countMismatch,
      fkConstraints: fks.length,
      fkOrphans: orphanTotal,
      residualEmailLikeValues: residualEmails,
      schemaDrift,
      policyCounts: Object.fromEntries(policyCounts),
      policyByColumn,
      manifest: manifest.rows,
      inconclusiveRecords: manifest.inconclusiveRecords,
    };
    const reportPath = join(phase2StateDir(), `copy-report-${Date.now()}.json`);
    writeFileSync(reportPath, JSON.stringify(report, null, 2));

    console.log("\n[phase2-local-copy] copy summary");
    console.log(`  tables ${report.tables}, rows ${report.rows}, count-mismatch tables ${countMismatch}`);
    console.log(`  FK constraints checked ${fks.length}, orphan rows ${orphanTotal}`);
    console.log("  unique constraints: enforced by indexes during INSERT (replica mode disables triggers only)");
    console.log(`  column policies: ${[...policyCounts.entries()].map(([k, v]) => `${k}=${v}`).join(" ")}`);
    console.log(`  residual email-like values after sanitization: ${residualEmails}`);
    console.log(`  non-blocking schema drift (source vs repository migrations): ${schemaDrift.length}`);
    printManifest(manifest);
    console.log(`  report (ids/labels/policies only): ${reportPath}`);
    if (countMismatch || orphanTotal || residualEmails) {
      console.error("[phase2-local-copy] FAIL: validation found problems (see above)");
      process.exitCode = 1;
    }
  } finally {
    await admin.$disconnect().catch(() => undefined);
    await local?.$disconnect().catch(() => undefined);
    await cluster.stop();
  }
}

async function manifestOnly() {
  requireAuthorization();
  const m = await source.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      return buildManifest(tx);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 300_000, maxWait: 30_000 },
  );
  printManifest(m);
  const cluster = await startPhase2LocalCluster();
  const local = new PrismaClient({ datasources: { db: { url: cluster.connectionUrl } }, log: ["error"] });
  try {
    await verifyLocalTarget(local, cluster.databaseDir);
    const stored = await local.$queryRaw<{ value: string }[]>`SELECT value FROM "_caretip_phase2_copy" WHERE key = 'manifest_sha'`;
    const same = stored[0]?.value === m.sha;
    console.log(`  local copy manifest sha: ${stored[0]?.value ?? "(none)"} -> ${same ? "REPRODUCED" : "DIFFERS (source changed since copy or rules changed)"}`);
  } finally {
    await local.$disconnect().catch(() => undefined);
    await cluster.stop();
  }
}

async function scan(script = "scripts/phase2-staging-financial-integrity-scan.ts") {
  if (!/^scripts\/[\w./-]+\.ts$/.test(script) || script.includes("..")) blocked(`script must be a path under scripts/: ${script}`);
  const cluster = await startPhase2LocalCluster();
  try {
    const env = {
      ...process.env,
      CARETIP_ISOLATED_POSTGRES_URL: cluster.connectionUrl,
      DATABASE_URL: cluster.connectionUrl,
      DATABASE_ALLOW_LOCALHOST: "true",
      CARETIP_ISOLATED_PG_DATA_DIR: cluster.databaseDir,
      CARETIP_ISOLATED_KEEP_STRIPE_TEST_KEY: "1",
      CARETIP_PHASE2_LOCAL_COPY_SCAN: "1",
    };
    const r = spawnSync(
      "npx",
      ["tsx", "scripts/lib/runWithIsolatedPostgres.ts", script],
      { cwd: backendRoot, env, stdio: "inherit", shell: true },
    );
    process.exitCode = r.status ?? 1;
  } finally {
    await cluster.stop();
  }
}

try {
  if (mode === "preflight") {
    await preflight();
    console.log(`\n[phase2-local-copy] preflight PASS. To authorize the copy: ${AUTH_ENV}=${sourceFingerprint}`);
  } else if (mode === "copy") {
    await copy();
  } else if (mode === "manifest") {
    await manifestOnly();
  } else if (mode === "scan") {
    await scan();
  } else if (mode === "run") {
    await scan(process.argv[3]?.replace(/\\/g, "/") ?? "");
  } else {
    blocked(`unknown mode '${mode}'`);
  }
} finally {
  await source.$disconnect().catch(() => undefined);
}
