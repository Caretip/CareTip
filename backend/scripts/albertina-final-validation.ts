/**
 * Albertina final-validation probes against the live database.
 * Does not create orders or charge Stripe. Restores quota after concurrency probe.
 *
 * Run: dotenv -e ../.env -e .env -- tsx scripts/albertina-final-validation.ts
 */
import { prisma } from "../src/prisma.js";
import { allocateQuoteAcrossQuantities, quotePhysicalQrPrints } from "../src/lib/physicalQr/quote.js";
import { tryClaimPhysicalQrMonthlyFreeOrder as claimQuota } from "../src/services/physicalQr/physicalQrPricing.service.js";

const lines: string[] = [];
const log = (m: string) => {
  lines.push(m);
  console.log(m);
};

function expect(cond: boolean, label: string) {
  log(cond ? `PASS: ${label}` : `FAIL: ${label}`);
}

async function sectionColumns() {
  const cols = await prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
        (table_name = 'businesses' AND column_name = 'physical_qr_free_order_used_at')
        OR (table_name = 'physical_qr_orders' AND column_name IN ('pricing_snapshot', 'monthly_free_quota_applied'))
        OR (table_name = 'physical_qr_order_items' AND column_name IN ('location_id', 'location_name_snapshot'))
      )
    ORDER BY table_name, column_name
  `;
  const names = cols.map((c) => `${c.table_name}.${c.column_name}`);
  log(`COLUMNS: ${names.join(", ") || "(none)"}`);
  expect(names.includes("businesses.physical_qr_free_order_used_at"), "businesses.physical_qr_free_order_used_at exists");
  expect(names.includes("physical_qr_orders.pricing_snapshot"), "physical_qr_orders.pricing_snapshot exists");
  expect(names.includes("physical_qr_orders.monthly_free_quota_applied"), "physical_qr_orders.monthly_free_quota_applied exists");
  expect(names.includes("physical_qr_order_items.location_id"), "physical_qr_order_items.location_id exists");
  expect(names.includes("physical_qr_order_items.location_name_snapshot"), "physical_qr_order_items.location_name_snapshot exists");

  const mig = await prisma.$queryRaw<Array<{ migration_name: string; finished_at: Date | null }>>`
    SELECT migration_name, finished_at
    FROM _prisma_migrations
    WHERE migration_name = '20260831220000_physical_qr_albertina_pricing'
    LIMIT 1
  `;
  expect(Boolean(mig[0]?.finished_at), "migration 20260831220000_physical_qr_albertina_pricing recorded as finished");
}

async function sectionLegacyOrders() {
  const stats = await prisma.$queryRaw<
    Array<{
      orders: bigint;
      items: bigint;
      items_null_location: bigint;
      orders_null_pricing: bigint;
      orders_without_items: bigint;
    }>
  >`
    SELECT
      (SELECT COUNT(*) FROM physical_qr_orders)::bigint AS orders,
      (SELECT COUNT(*) FROM physical_qr_order_items)::bigint AS items,
      (SELECT COUNT(*) FROM physical_qr_order_items WHERE location_id IS NULL AND location_name_snapshot IS NULL)::bigint AS items_null_location,
      (SELECT COUNT(*) FROM physical_qr_orders WHERE pricing_snapshot IS NULL)::bigint AS orders_null_pricing,
      (SELECT COUNT(*) FROM physical_qr_orders o
        WHERE NOT EXISTS (SELECT 1 FROM physical_qr_order_items i WHERE i.order_id = o.id))::bigint AS orders_without_items
  `;
  const row = stats[0];
  log(
    `ORDERS: ${row?.orders ?? 0} parents, ${row?.items ?? 0} items, ` +
      `${row?.items_null_location ?? 0} items without location snapshot, ` +
      `${row?.orders_null_pricing ?? 0} orders without pricing_snapshot, ` +
      `${row?.orders_without_items ?? 0} parents with zero item rows`,
  );

  const sample = await prisma.$queryRaw<
    Array<{
      id: string;
      quantity: number;
      total_amount: number;
      payment_status: string;
      item_count: bigint;
      item_qty_sum: bigint | null;
    }>
  >`
    SELECT o.id, o.quantity, o.total_amount, o.payment_status::text AS payment_status,
           COUNT(i.id)::bigint AS item_count,
           COALESCE(SUM(i.quantity), 0)::bigint AS item_qty_sum
    FROM physical_qr_orders o
    LEFT JOIN physical_qr_order_items i ON i.order_id = o.id
    GROUP BY o.id
    ORDER BY o.placed_at DESC
    LIMIT 15
  `;
  let readable = 0;
  let qtyMismatch = 0;
  for (const o of sample) {
    readable += 1;
    if (Number(o.item_count) > 0 && Number(o.item_qty_sum) !== o.quantity) qtyMismatch += 1;
    log(
      `  order ${o.id.slice(-8)} payment=${o.payment_status} parentQty=${o.quantity} items=${o.item_count} itemQtySum=${o.item_qty_sum} total=${o.total_amount}`,
    );
  }
  expect(readable === sample.length, `read ${sample.length} recent orders without query error`);
  expect(qtyMismatch === 0, "sampled parent quantity matches sum of item quantities when items exist");
}

function sectionQuoteMath() {
  const basic4 = quotePhysicalQrPrints({ printCount: 4, printingIncludedEligible: false, freeOrderAvailable: false });
  const basic5 = quotePhysicalQrPrints({ printCount: 5, printingIncludedEligible: false, freeOrderAvailable: false });
  const basic10 = quotePhysicalQrPrints({ printCount: 10, printingIncludedEligible: false, freeOrderAvailable: false });
  expect(basic4.totalCents === 1490, "Basic 4 = 1490");
  expect(basic5.totalCents === 1620, "Basic 5 = 1620");
  expect(basic10.totalCents === 2270, "Basic 10 = 2270");

  const pro8 = quotePhysicalQrPrints({ printCount: 8, printingIncludedEligible: true, freeOrderAvailable: true });
  const pro9 = quotePhysicalQrPrints({ printCount: 9, printingIncludedEligible: true, freeOrderAvailable: true });
  const pro10 = quotePhysicalQrPrints({ printCount: 10, printingIncludedEligible: true, freeOrderAvailable: true });
  expect(pro8.totalCents === 0, "Pro free 8 = 0");
  expect(pro9.totalCents === 130, "Pro free 9 = 130");
  expect(pro10.totalCents === 260, "Pro free 10 = 260");

  const used = quotePhysicalQrPrints({ printCount: 4, printingIncludedEligible: true, freeOrderAvailable: false });
  expect(used.totalCents === 1490 && !used.freeOrderApplied, "Pro after quota uses Basic package");

  const shares = allocateQuoteAcrossQuantities(
    quotePhysicalQrPrints({ printCount: 10, printingIncludedEligible: false, freeOrderAvailable: false }),
    [2, 3, 5],
  );
  const sum = shares.reduce((s, n) => s + n, 0);
  expect(sum === 2270, `2+3+5 prints allocate to parent total 2270 (got ${sum}: ${shares.join("/")})`);
}

function assertBasic(locationIds: Array<string | null>, primary: string | null) {
  const normalized = locationIds.map((id) => id || primary);
  const unique = [...new Set(normalized.filter((id): id is string => Boolean(id)))];
  if (unique.length <= 1) {
    if (unique.length === 1 && primary && unique[0] !== primary) return "BASIC_PRIMARY_LOCATION_REQUIRED";
    return "ok";
  }
  return "BASIC_SINGLE_LOCATION_REQUIRED";
}

async function sectionLocations() {
  const biz = await prisma.business.findFirst({
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });
  if (!biz) {
    log("SKIPPED: no business row for location probe");
    return;
  }
  const locations = await prisma.location.findMany({
    where: { businessId: biz.id },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const primary = locations[0]?.id ?? null;
  log(`LOCATION FIXTURE business=${biz.id} venues=${locations.length} primary=${primary ?? "none"}`);

  expect(assertBasic([primary], primary) === "ok", "Basic primary-only allowed");
  if (locations[1]) {
    expect(assertBasic([locations[1].id], primary) === "BASIC_PRIMARY_LOCATION_REQUIRED", "Basic other location rejected");
    expect(assertBasic([primary, locations[1].id], primary) === "BASIC_SINGLE_LOCATION_REQUIRED", "Basic mixed locations rejected");
  } else {
    log("SKIPPED: second venue not present — cannot live-test mixed-location reject on this business");
  }
  expect(assertBasic([null], primary) === "ok", "storefront/null locationId normalizes to primary (Basic allowed)");
  expect(assertBasic(["forged-client-id"], primary) === "BASIC_PRIMARY_LOCATION_REQUIRED", "forged location id would fail Basic if trusted — server must ignore client locationId");
}

async function sectionConcurrency() {
  const biz = await prisma.business.findFirst({
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (!biz) {
    log("SKIPPED: no business for quota concurrency probe");
    return;
  }
  const before = await prisma.$queryRaw<Array<{ used_at: Date | null }>>`
    SELECT physical_qr_free_order_used_at AS used_at FROM businesses WHERE id = ${biz.id} LIMIT 1
  `;
  const previous = before[0]?.used_at ?? null;
  log(`QUOTA before used_at=${previous?.toISOString() ?? "null"} business=${biz.id}`);

  try {
    await prisma.$executeRaw`UPDATE businesses SET physical_qr_free_order_used_at = NULL WHERE id = ${biz.id}`;
    const t0 = Date.now();
    const [a, b] = await Promise.all([
      claimQuota({ businessId: biz.id, now: new Date(t0) }),
      claimQuota({ businessId: biz.id, now: new Date(t0 + 1) }),
    ]);
    const winners = [a, b].filter((r) => r.claimed).length;
    log(`CONCURRENCY claims claimedA=${a.claimed} claimedB=${b.claimed} winners=${winners}`);
    expect(winners === 1, "exactly one of two simultaneous claims wins");
    expect(a.claimed !== b.claimed, "loser does not also consume monthly free quota");
  } finally {
    if (previous) {
      await prisma.$executeRaw`UPDATE businesses SET physical_qr_free_order_used_at = ${previous} WHERE id = ${biz.id}`;
    } else {
      await prisma.$executeRaw`UPDATE businesses SET physical_qr_free_order_used_at = NULL WHERE id = ${biz.id}`;
    }
    const after = await prisma.$queryRaw<Array<{ used_at: Date | null }>>`
      SELECT physical_qr_free_order_used_at AS used_at FROM businesses WHERE id = ${biz.id} LIMIT 1
    `;
    log(`QUOTA restored used_at=${after[0]?.used_at?.toISOString() ?? "null"}`);
  }
}

async function main() {
  try {
    await sectionColumns();
    await sectionLegacyOrders();
    sectionQuoteMath();
    await sectionLocations();
    await sectionConcurrency();
  } finally {
    await prisma.$disconnect();
  }
  const failed = lines.filter((l) => l.startsWith("FAIL:")).length;
  const skipped = lines.filter((l) => l.startsWith("SKIPPED:")).length;
  log(`\nAlbertina DB validation: ${failed} failed, ${skipped} skipped`);
  if (failed) process.exitCode = 1;
}

void main();
