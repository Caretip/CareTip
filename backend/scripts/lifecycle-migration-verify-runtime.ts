/**
 * I-R2 — Lifecycle migration consistency check (fail-safe, non-destructive).
 * Run: npm run test:lifecycle-migration-verify (from backend/)
 *
 * Verifies F-C enum labels + G legal-hold columns exist.
 * On partial/inconsistent state: FAIL with guidance (no destructive repair).
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { prisma } from "../src/prisma.js";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

const REQUIRED_ENUM_LABELS = [
  "erasure_continue",
  "anonymize_user",
  "anonymize_employee",
  "kyc_secure_destroy",
  "analytics_ttl",
  "audit_scrub",
  "storage_orphan_gc",
  "support_redact",
  "dsar_export",
  "notify_cleanup",
  "guest_scrub",
  "billing_redact",
  "staff_pii_scrub",
] as const;

async function main() {
  const enumRows = await prisma.$queryRaw<Array<{ enumlabel: string }>>`
    SELECT e.enumlabel
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'DataLifecycleJobType'
    ORDER BY e.enumsortorder
  `;
  const labels = new Set(enumRows.map((r) => r.enumlabel));
  if (labels.size === 0) {
    fail("DataLifecycleJobType enum missing entirely — run prisma migrate deploy on a fresh DB");
  } else {
    pass(`DataLifecycleJobType present with ${labels.size} label(s)`);
  }

  const missing = REQUIRED_ENUM_LABELS.filter((l) => !labels.has(l));
  const presentFc = ["notify_cleanup", "guest_scrub", "billing_redact", "staff_pii_scrub"].filter(
    (l) => labels.has(l),
  );
  if (missing.length === 0) {
    pass("all required DataLifecycleJobType labels present (incl. F-C)");
  } else if (presentFc.length > 0 && presentFc.length < 4) {
    fail(
      `PARTIAL F-C enum state: have [${presentFc.join(",")}] missing [${missing.join(",")}]. ` +
        `Do not invent destructive recovery. Re-run: npx prisma migrate deploy ` +
        `(migration 20260810160000 uses ADD VALUE IF NOT EXISTS).`,
    );
  } else {
    fail(
      `Missing DataLifecycleJobType labels: ${missing.join(", ")}. ` +
        `Apply migrations with prisma migrate deploy (non-destructive).`,
    );
  }

  // G columns on "User" and businesses
  const userCol = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'User'
      AND column_name = 'legal_hold_set_by_user_id'
  `;
  const bizCol = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'businesses'
      AND column_name = 'legal_hold_set_by_user_id'
  `;

  if (userCol.length === 1) pass('User.legal_hold_set_by_user_id present');
  else fail('User.legal_hold_set_by_user_id missing — apply 20260810170000 migration');

  if (bizCol.length === 1) pass("businesses.legal_hold_set_by_user_id present");
  else fail("businesses.legal_hold_set_by_user_id missing — apply 20260810170000 migration");

  // Migration history consistency for the two I-R2 migrations
  const migrations = await prisma.$queryRaw<Array<{ migration_name: string; finished_at: Date | null }>>`
    SELECT migration_name, finished_at
    FROM _prisma_migrations
    WHERE migration_name IN (
      '20260810160000_data_lifecycle_fc_job_types',
      '20260810170000_data_lifecycle_legal_hold_set_by',
      '20260810180000_data_lifecycle_fc_enum_idempotent'
    )
  `;
  const byName = new Map(migrations.map((m) => [m.migration_name, m]));
  for (const name of [
    "20260810160000_data_lifecycle_fc_job_types",
    "20260810170000_data_lifecycle_legal_hold_set_by",
    "20260810180000_data_lifecycle_fc_enum_idempotent",
  ]) {
    const row = byName.get(name);
    if (row && row.finished_at) pass(`_prisma_migrations records ${name} finished`);
    else if (row && !row.finished_at) {
      fail(
        `${name} is recorded but unfinished — inconsistent migration state. ` +
          `Resolve with prisma migrate resolve after verifying schema objects; do not DROP data.`,
      );
    } else {
      // Columns/enums may exist from manual apply; still require migration history for CI freshness.
      fail(`${name} not in _prisma_migrations — migrate deploy required for CI reliability`);
    }
  }

  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL"));
  if (failed.length) {
    console.error(`\n${failed.length} migration verification failure(s)`);
    process.exit(1);
  }
  console.log(`\nAll ${results.length} migration verification checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
