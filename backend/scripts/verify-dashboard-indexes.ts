/**
 * Verifies dashboard performance indexes exist in the connected database.
 * Run: npm run db:verify-dashboard-indexes
 */
import "../src/loadEnv.js";
import { prisma } from "../src/prisma.js";

const REQUIRED_INDEXES: Array<{ table: string; index: string }> = [
  { table: "tips", index: "tips_employee_id_status_created_at_idx" },
  { table: "tips", index: "tips_business_id_status_created_at_idx" },
  { table: "refresh_tokens", index: "refresh_tokens_user_id_revoked_at_idx" },
  { table: "notifications", index: "notifications_user_id_unread_idx" },
  { table: "employees", index: "employees_business_id_active_name_idx" },
  { table: "employees", index: "employees_business_id_active_activation_active_idx" },
  { table: "employees", index: "employees_business_id_missing_qr_idx" },
  { table: "employee_goals", index: "employee_goals_employee_status_updated_idx" },
  { table: "employee_goals", index: "employee_goals_active_updated_idx" },
  { table: "businesses", index: "businesses_verification_status_idx" },
  { table: "businesses", index: "businesses_verification_pending_kyc_idx" },
];

async function main(): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ tablename: string; indexname: string }>>`
    SELECT tablename, indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename IN (
        'tips',
        'employees',
        'employee_goals',
        'refresh_tokens',
        'notifications',
        'businesses'
      )
  `;

  const present = new Set(rows.map((r) => `${r.tablename}:${r.indexname}`));
  const missing: string[] = [];
  const found: string[] = [];

  for (const { table, index } of REQUIRED_INDEXES) {
    const key = `${table}:${index}`;
    if (present.has(key)) found.push(index);
    else missing.push(`${table}.${index}`);
  }

  console.info("[verify-dashboard-indexes] found:", found.length, "/", REQUIRED_INDEXES.length);
  for (const name of found) console.info("  OK", name);

  if (missing.length > 0) {
    console.error("[verify-dashboard-indexes] MISSING:");
    for (const name of missing) console.error("  -", name);
    console.error("\nApply: npm run db:migrate:deploy");
    process.exit(1);
  }

  console.info("[verify-dashboard-indexes] All required dashboard indexes are present.");
}

main()
  .catch((err) => {
    console.error("[verify-dashboard-indexes] failed", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
