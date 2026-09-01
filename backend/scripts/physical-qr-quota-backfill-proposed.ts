/**
 * REPORT ONLY. Does not UPDATE businesses or orders.
 *
 * Finds PAID Physical QR orders that consumed the monthly free quota
 * (monthly_free_quota_applied = true) whose businesses.physical_qr_free_order_used_at
 * is missing or falls in an earlier Europe/Berlin calendar month than paid_at.
 *
 * Run:
 *   dotenv -e ../.env -e .env -- tsx scripts/physical-qr-quota-backfill-proposed.ts
 *
 * Do not apply the printed SQL without explicit approval.
 */
import { DateTime } from "luxon";
import { prisma } from "../src/prisma.js";
import { PHYSICAL_QR_PROCESSING_TIMEZONE } from "../src/lib/physicalQr/processing.js";
import { berlinCalendarMonthStart } from "../src/lib/physicalQr/quote.js";

type Row = {
  order_id: string;
  business_id: string;
  paid_at: Date;
  used_at: Date | null;
  timezone: string | null;
  monthly_free_quota_applied: boolean;
  payment_status: string;
};

function monthStartIso(at: Date, zone: string): string {
  return berlinCalendarMonthStart(at, zone).toISOString();
}

async function main() {
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT
      o.id AS order_id,
      o.business_id,
      o.paid_at,
      b.physical_qr_free_order_used_at AS used_at,
      b.timezone,
      o.monthly_free_quota_applied,
      o.payment_status::text AS payment_status
    FROM physical_qr_orders o
    JOIN businesses b ON b.id = o.business_id
    WHERE o.payment_status::text = 'PAID'
      AND o.monthly_free_quota_applied = true
      AND o.paid_at IS NOT NULL
    ORDER BY o.paid_at ASC
  `;

  const proposed: string[] = [];
  for (const row of rows) {
    const zone = row.timezone?.trim() || PHYSICAL_QR_PROCESSING_TIMEZONE;
    const paidMonth = monthStartIso(row.paid_at, zone);
    const usedMonth = row.used_at ? monthStartIso(row.used_at, zone) : null;
    if (usedMonth === paidMonth) continue;
    const localPaid = DateTime.fromJSDate(row.paid_at, { zone: "utc" }).setZone(zone).toISO();
    console.log(
      JSON.stringify({
        order_id: row.order_id,
        business_id: row.business_id,
        paid_at_utc: row.paid_at.toISOString(),
        paid_at_local: localPaid,
        used_at_utc: row.used_at?.toISOString() ?? null,
        paid_month_start_utc: paidMonth,
        used_month_start_utc: usedMonth,
      }),
    );
    proposed.push(
      `-- business ${row.business_id} order ${row.order_id}\n` +
        `UPDATE businesses SET physical_qr_free_order_used_at = '${row.paid_at.toISOString()}' ` +
        `WHERE id = '${row.business_id}' ` +
        `AND (physical_qr_free_order_used_at IS NULL OR physical_qr_free_order_used_at < '${paidMonth}');`,
    );
  }

  if (!proposed.length) {
    console.log("NO_BACKFILL_CANDIDATES");
    return;
  }

  console.log("\n-- Proposed SQL (NOT EXECUTED). Requires explicit approval.\n");
  console.log(proposed.join("\n"));
}

main()
  .catch((err) => {
    console.error("REPORT_FAILED", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
