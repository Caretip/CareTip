/**
 * Phase 1 — read-only historical ownership audit for QR scan / guest visit rows.
 *
 * Reports cross-tenant mismatches. Never mutates data.
 *
 * Run: npm run audit:qr-scan-ownership
 */
import "../src/loadEnv.js";
import { prisma } from "../src/prisma.js";

type CountRow = { c: bigint };

async function count(query: Promise<CountRow[]>): Promise<number> {
  const rows = await query;
  return Number(rows[0]?.c ?? 0);
}

async function main() {
  console.info("[qr-ownership-audit] Read-only scan of historical mismatches…\n");

  const employeeMismatches = await count(prisma.$queryRaw<CountRow[]>`
    SELECT COUNT(*)::bigint AS c
    FROM qr_scan_events s
    INNER JOIN employees e ON e.id = s.employee_id
    WHERE s.employee_id IS NOT NULL
      AND e.business_id <> s.business_id
  `);

  const locationMismatches = await count(prisma.$queryRaw<CountRow[]>`
    SELECT COUNT(*)::bigint AS c
    FROM qr_scan_events s
    INNER JOIN locations l ON l.id = s.location_id
    WHERE s.location_id IS NOT NULL
      AND l.business_id <> s.business_id
  `);

  const tableMismatches = await count(prisma.$queryRaw<CountRow[]>`
    SELECT COUNT(*)::bigint AS c
    FROM qr_scan_events s
    INNER JOIN venue_tables t ON t.id = s.table_id
    INNER JOIN locations l ON l.id = t.location_id
    WHERE s.table_id IS NOT NULL
      AND l.business_id <> s.business_id
  `);

  const visitEmployeeMismatches = await count(prisma.$queryRaw<CountRow[]>`
    SELECT COUNT(*)::bigint AS c
    FROM qr_guest_visits v
    INNER JOIN employees e ON e.id = v.employee_id
    WHERE v.employee_id IS NOT NULL
      AND e.business_id <> v.business_id
  `);

  const visitLocationMismatches = await count(prisma.$queryRaw<CountRow[]>`
    SELECT COUNT(*)::bigint AS c
    FROM qr_guest_visits v
    INNER JOIN locations l ON l.id = v.location_id
    WHERE v.location_id IS NOT NULL
      AND l.business_id <> v.business_id
  `);

  const visitTableMismatches = await count(prisma.$queryRaw<CountRow[]>`
    SELECT COUNT(*)::bigint AS c
    FROM qr_guest_visits v
    INNER JOIN venue_tables t ON t.id = v.table_id
    INNER JOIN locations l ON l.id = t.location_id
    WHERE v.table_id IS NOT NULL
      AND l.business_id <> v.business_id
  `);

  const sampleScans = await prisma.$queryRaw<
    Array<{
      id: string;
      scan_business: string;
      employee_business: string | null;
      employee_id: string | null;
      scanned_at: Date;
    }>
  >`
    SELECT s.id, s.business_id AS scan_business, e.business_id AS employee_business,
           s.employee_id, s.scanned_at
    FROM qr_scan_events s
    INNER JOIN employees e ON e.id = s.employee_id
    WHERE s.employee_id IS NOT NULL
      AND e.business_id <> s.business_id
    ORDER BY s.scanned_at DESC
    LIMIT 10
  `;

  console.info("qr_scan_events mismatches:");
  console.info(`  employeeId → wrong business: ${employeeMismatches}`);
  console.info(`  locationId → wrong business: ${locationMismatches}`);
  console.info(`  tableId    → wrong business: ${tableMismatches}`);
  console.info("\nqr_guest_visits mismatches:");
  console.info(`  employeeId → wrong business: ${visitEmployeeMismatches}`);
  console.info(`  locationId → wrong business: ${visitLocationMismatches}`);
  console.info(`  tableId    → wrong business: ${visitTableMismatches}`);

  if (sampleScans.length > 0) {
    console.info("\nSample employee mismatches (up to 10):");
    for (const row of sampleScans) {
      console.info(
        `  scan=${row.id} scanBiz=${row.scan_business} empBiz=${row.employee_business} emp=${row.employee_id} at=${row.scanned_at.toISOString()}`,
      );
    }
  }

  const total =
    employeeMismatches +
    locationMismatches +
    tableMismatches +
    visitEmployeeMismatches +
    visitLocationMismatches +
    visitTableMismatches;

  console.info(`\n[qr-ownership-audit] Done. Total mismatch rows: ${total}`);
  console.info("No data was modified.");
  // Exit 0 even when mismatches exist — this is a report, not a gate.
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
