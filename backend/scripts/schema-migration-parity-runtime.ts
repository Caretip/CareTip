/**
 * Schema/migration parity on a database built only from prisma/migrations (disposable Postgres).
 *
 *   tsx scripts/lib/runWithIsolatedPostgres.ts scripts/schema-migration-parity-runtime.ts
 *
 * Compares the migrated database with schema.prisma (`prisma migrate diff --from-url`) and fails on
 * any difference outside KNOWN_DRIFT, plus behavioural checks for drift that broke application writes.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { completeIsolatedPostgresBootstrap } from "./lib/isolatedPostgresTestGate.js";

await completeIsolatedPostgresBootstrap();
const { prisma } = await import("../src/prisma.js");

/** Statements `migrate diff` may still emit; each one is documented drift, not an accidental change. */
const KNOWN_DRIFT: RegExp[] = [
  /^ALTER INDEX "[^"]+" RENAME TO "[^"]+";$/,
  /^ALTER TABLE "employee_tip_distribution_allocations" RENAME CONSTRAINT "[^"]+" TO "[^"]+";$/,
  /^DROP INDEX "(User_account_status_idx|businesses_lifecycle_status_idx|employees_business_id_active_name_idx)";$/,
  /^CREATE INDEX "employees_business_id_is_active_name_idx" ON "employees"\("business_id", "is_active", "name"\);$/,
  /^ALTER TABLE "(businesses|employees|physical_qr_orders|scheduled_payout_ops_incident_deliveries|stripe_webhook_events|user_settings)" ALTER COLUMN /,
  /^ALTER COLUMN /,
];

function pass(id: string, msg: string) {
  console.log(`  ✓ ${id}: ${msg}`);
}

try {
  const goalIndexes = await prisma.$queryRaw<{ name: string; uniq: boolean; cols: string }[]>`
    SELECT ic.relname AS name, i.indisunique AS uniq,
      (SELECT string_agg(a.attname, ',' ORDER BY k.ord) FROM unnest(i.indkey) WITH ORDINALITY k(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum) AS cols
    FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid JOIN pg_class tc ON tc.oid = i.indrelid
    WHERE tc.relname = 'employee_goals'`;
  assert.ok(
    !goalIndexes.some((i) => i.uniq && i.cols === "employee_id"),
    "employee_goals must not have a unique index on employee_id (multiple goals per employee)",
  );
  pass("employee-goals-not-unique", "migrations leave no unique index on employee_goals(employee_id)");

  const inserted = await prisma
    .$transaction(async (tx) => {
      const user = await tx.user.create({ data: { email: `parity-${Date.now()}@example.com`, role: "MANAGER" } });
      const business = await tx.business.create({ data: { name: "Parity", slug: `parity-${Date.now()}`, userId: user.id } });
      const employee = await tx.employee.create({ data: { name: "Parity", jobTitle: "Staff", businessId: business.id } });
      for (const name of ["Goal A", "Goal B"]) {
        await tx.employeeGoal.create({
          data: { employeeId: employee.id, name, goalAmount: 100, goalPeriod: "monthly", startDate: new Date("2026-10-01") },
        });
      }
      const n = await tx.employeeGoal.count({ where: { employeeId: employee.id } });
      throw Object.assign(new Error("rollback"), { inserted: n });
    })
    .catch((e: { inserted?: number }) => {
      if (e.inserted === undefined) throw e;
      return e.inserted;
    });
  assert.equal(inserted, 2);
  pass("employee-goals-multi-row", "two goals for one employee insert on a migrations-built database (rolled back)");

  const diff = spawnSync(
    "npx",
    ["prisma", "migrate", "diff", "--from-url", `"${process.env.DATABASE_URL}"`, "--to-schema-datamodel", "prisma/schema.prisma", "--script"],
    { encoding: "utf8", shell: true },
  );
  assert.equal(diff.status, 0, "prisma migrate diff failed");
  const statements = diff.stdout
    .split("\n")
    .map((l) => l.trim().replace(/,$/, ";"))
    .filter((l) => /^(ALTER|CREATE|DROP|COMMENT|ADD|RENAME|UPDATE|INSERT|DELETE)\b/.test(l));
  const unexpected = statements.filter((s) => !KNOWN_DRIFT.some((re) => re.test(s)));
  assert.deepEqual(unexpected, [], `unexpected schema/migration drift:\n${unexpected.join("\n")}`);
  pass("schema-migration-parity", `${statements.length} known drift statements, 0 unexpected`);

  console.log("\nschema-migration-parity-runtime: OK");
} finally {
  await prisma.$disconnect();
}
