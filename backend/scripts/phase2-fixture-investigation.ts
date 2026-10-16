/**
 * Phase 2 read-only fixture investigation for rows flagged by phase2-staging-financial-integrity-scan.
 *
 *   CARETIP_PHASE2_FIXTURE_INVESTIGATION_ACK=1 npx dotenv -e ../.env -e .env -- tsx scripts/phase2-fixture-investigation.ts
 *
 * Every query runs inside one `SET TRANSACTION READ ONLY` transaction (the server rejects writes).
 * No Stripe API calls. Prints internal ids and evidence labels only - never names, emails, or slugs.
 * Full per-row detail is written to the OS temp directory (outside the repository).
 */
import "../src/loadEnv.js";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CARETIP_FEE_FIXED_CENTS_EUR, CARETIP_FEE_PERCENT } from "../src/config/fees.js";
import { prisma } from "../src/prisma.js";
import {
  classifyRecord,
  emailClass,
  suitePrefixForSlug,
  type IdShape,
  type RecordClassification,
} from "./lib/phase2FixtureClassification.js";

const ACK_ENV = "CARETIP_PHASE2_FIXTURE_INVESTIGATION_ACK";
if (process.env[ACK_ENV] !== "1" || process.env.NODE_ENV === "production") {
  console.error(`[fixture-investigation] BLOCKED: requires ${ACK_ENV}=1 and NODE_ENV != production.`);
  process.exit(2);
}

type BusinessInfo = {
  id: string;
  slug: string;
  createdAt: Date;
  stripeAccountId: string | null;
  user: { email: string } | null;
};

type Evidence = {
  set: string;
  recordId: string;
  recordCreatedAt: string;
  businessId: string | null;
  suite: string | null;
  slugRunVsBusinessCreatedMin: number | null;
  managerEmail: string;
  acct: IdShape;
  pi: IdShape;
  tr: IdShape;
  transferErrorPrefix: string | null;
  classification: RecordClassification;
  reason: string;
};

function classify(input: {
  set: string;
  recordId: string;
  recordCreatedAt: Date;
  business: BusinessInfo | null;
  paymentIntentId: string | null;
  transferId: string | null;
  lastTransferError: string | null;
  tipId: string | null;
}): Evidence {
  const b = input.business;
  const r = classifyRecord({
    business: b
      ? { id: b.id, slug: b.slug, createdAt: b.createdAt, stripeAccountId: b.stripeAccountId, managerEmail: b.user?.email ?? null }
      : null,
    paymentIntentId: input.paymentIntentId,
    transferId: input.transferId,
    tipId: input.tipId,
  });
  return {
    set: input.set,
    recordId: input.recordId,
    recordCreatedAt: input.recordCreatedAt.toISOString(),
    businessId: b?.id ?? null,
    suite: r.business?.suite ?? null,
    slugRunVsBusinessCreatedMin: r.business?.slugRunVsBusinessCreatedMin ?? null,
    managerEmail: r.business?.managerEmail ?? "none",
    acct: r.business?.account ?? "none",
    pi: r.pi,
    tr: r.tr,
    transferErrorPrefix: input.lastTransferError ? input.lastTransferError.split(":")[0].slice(0, 40) : null,
    classification: r.classification,
    reason: r.reason,
  };
}

const LEDGER_MIGRATION = "20260910080000_employee_tip_direct_payout_ledger";
const businessSelect = { id: true, slug: true, createdAt: true, stripeAccountId: true, user: { select: { email: true } } } as const;

const evidence = await prisma.$transaction(
  async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const ro = await tx.$queryRaw<{ ro: string }[]>`SELECT current_setting('transaction_read_only') AS ro`;
    if (ro[0]?.ro !== "on") throw new Error("transaction is not read-only");
    console.log("[fixture-investigation] transaction_read_only = on");

    const ids = async (q: Promise<{ id: string }[]>) => (await q).map((r) => r.id);
    const ledger = await tx.$queryRaw<{ finished_at: Date | null }[]>`
      SELECT finished_at FROM _prisma_migrations WHERE migration_name = ${LEDGER_MIGRATION}`;
    const ledgerAt = ledger[0]?.finished_at ?? new Date(0);

    const tipSets: Record<string, string[]> = {
      missing_payable_post_ledger: await ids(tx.$queryRaw`
        SELECT t.id FROM tips t LEFT JOIN employee_tip_payables p ON p.transaction_id = t.id
        WHERE t.status = 'success' AND t.employee_id IS NOT NULL AND p.id IS NULL AND t.created_at >= ${ledgerAt}`),
      stale_pending_tip: await ids(tx.$queryRaw`
        SELECT id FROM tips WHERE status = 'pending' AND created_at < NOW() - make_interval(hours => 24)`),
    };
    const payableSets: Record<string, string[]> = {
      payable_split_broken: await ids(tx.$queryRaw`
        SELECT id FROM employee_tip_payables WHERE payable_cents <> gross_cents - platform_fee_cents`),
      destination_mismatch: await ids(tx.$queryRaw`
        SELECT p.id FROM employee_tip_payables p JOIN businesses b ON b.id = p.business_id
        WHERE p.routing_mode = 'business_distribution' AND p.charge_model = 'destination_business'
          AND p.stripe_destination_account_id IS NOT NULL AND b.stripe_account_id IS NOT NULL
          AND p.stripe_destination_account_id <> b.stripe_account_id`),
      platform_hold_business_distribution: await ids(tx.$queryRaw`
        SELECT id FROM employee_tip_payables
        WHERE routing_mode = 'business_distribution' AND charge_model = 'platform_hold'`),
      aged_held_business: await ids(tx.$queryRaw`
        SELECT id FROM employee_tip_payables
        WHERE routing_mode = 'business_distribution' AND charge_model = 'destination_business'
          AND status = 'held_business' AND created_at < NOW() - make_interval(days => 30)
          AND payable_cents - transferred_cents - reversed_cents - refunded_cents
              - disputed_open_cents - disputed_lost_cents > 0`),
      allocated_above_remaining: await ids(tx.$queryRaw`
        SELECT p.id FROM employee_tip_payables p
        JOIN (SELECT employee_tip_payable_id, SUM(amount_cents)::int AS s
              FROM employee_tip_distribution_allocations GROUP BY employee_tip_payable_id) x
          ON x.employee_tip_payable_id = p.id
        WHERE x.s <= p.payable_cents
          AND x.s > GREATEST(p.payable_cents - p.transferred_cents - p.reversed_cents - p.refunded_cents
                             - p.disputed_open_cents - p.disputed_lost_cents, 0)`),
      stale_transferring: await ids(tx.$queryRaw`
        SELECT id FROM employee_tip_payables
        WHERE status = 'transferring' AND updated_at < NOW() - make_interval(mins => 60)`),
      durable_transfer_marker: await ids(tx.$queryRaw`
        SELECT id FROM employee_tip_payables
        WHERE last_transfer_error LIKE 'rel_durable:%' OR last_transfer_error LIKE 'orphan_suspected:%'`),
      transfer_failed: await ids(tx.$queryRaw`
        SELECT id FROM employee_tip_payables WHERE status = 'transfer_failed'`),
      refunded_without_refund_row: await ids(tx.$queryRaw`
        SELECT p.id FROM employee_tip_payables p
        LEFT JOIN (SELECT DISTINCT tip_id FROM tip_refunds
                   WHERE kind = 'refund' AND status = 'succeeded' AND tip_id IS NOT NULL) r
          ON r.tip_id = p.transaction_id
        WHERE p.refunded_cents > 0 AND r.tip_id IS NULL`),
      frozen_fee_differs_from_formula: await ids(tx.$queryRaw`
        SELECT id FROM employee_tip_payables
        WHERE platform_fee_cents <> (gross_cents * ${CARETIP_FEE_PERCENT}::int) / 100 + ${CARETIP_FEE_FIXED_CENTS_EUR}::int
           OR (gross_cents * ${CARETIP_FEE_PERCENT}::int) / 100 + ${CARETIP_FEE_FIXED_CENTS_EUR}::int >= gross_cents`),
      has_stripe_transfer_id: await ids(tx.$queryRaw`
        SELECT id FROM employee_tip_payables WHERE stripe_transfer_id IS NOT NULL`),
    };

    const out: Evidence[] = [];
    const allTipIds = [...new Set(Object.values(tipSets).flat())];
    const tips = await tx.transaction.findMany({
      where: { id: { in: allTipIds } },
      select: { id: true, createdAt: true, stripePaymentIntentId: true, business: { select: businessSelect } },
    });
    const tipById = new Map(tips.map((t) => [t.id, t]));
    for (const [set, list] of Object.entries(tipSets)) {
      for (const id of list) {
        const t = tipById.get(id);
        if (!t) continue;
        out.push(classify({ set, recordId: id, recordCreatedAt: t.createdAt, business: t.business,
          paymentIntentId: t.stripePaymentIntentId, transferId: null, lastTransferError: null, tipId: t.id }));
      }
    }

    const allPayableIds = [...new Set(Object.values(payableSets).flat())];
    const payables = await tx.employeeTipPayable.findMany({
      where: { id: { in: allPayableIds } },
      select: { id: true, createdAt: true, transactionId: true, stripePaymentIntentId: true, stripeTransferId: true,
        lastTransferError: true, business: { select: businessSelect } },
    });
    const payableById = new Map(payables.map((p) => [p.id, p]));
    for (const [set, list] of Object.entries(payableSets)) {
      for (const id of list) {
        const p = payableById.get(id);
        if (!p) continue;
        out.push(classify({ set, recordId: id, recordCreatedAt: p.createdAt, business: p.business,
          paymentIntentId: p.stripePaymentIntentId, transferId: p.stripeTransferId,
          lastTransferError: p.lastTransferError, tipId: p.transactionId }));
      }
    }
    // Lifecycle coverage outside fixture tenants (aggregate counts only).
    const businesses = await tx.business.findMany({ select: businessSelect });
    const fixtureBiz = new Set(
      businesses
        .filter((b) => suitePrefixForSlug(b.slug) != null || emailClass(b.user?.email) === "example.com")
        .map((b) => b.id),
    );
    const nonFixture = businesses.filter((b) => !fixtureBiz.has(b.id)).map((b) => b.id);
    const payableStates = await tx.employeeTipPayable.groupBy({
      by: ["routingMode", "chargeModel", "status"],
      where: { businessId: { in: nonFixture } },
      _count: { _all: true },
    });
    const refundStates = await tx.tipRefund.groupBy({
      by: ["kind", "status"],
      where: { businessId: { in: nonFixture } },
      _count: { _all: true },
    });
    const [tipsSuccess, allocations, batches, realTransfers, disputedPayables, connectPayouts] = await Promise.all([
      tx.transaction.count({ where: { businessId: { in: nonFixture }, status: "success" } }),
      tx.employeeTipDistributionAllocation.count({ where: { businessId: { in: nonFixture } } }),
      tx.employeeTipDistributionBatch.count({ where: { businessId: { in: nonFixture } } }),
      tx.employeeTipPayable.count({ where: { businessId: { in: nonFixture }, stripeTransferId: { not: null } } }),
      tx.employeeTipPayable.count({
        where: { businessId: { in: nonFixture }, OR: [{ disputedOpenCents: { gt: 0 } }, { disputedLostCents: { gt: 0 } }] },
      }),
      tx.stripeConnectPayout.count({ where: { businessId: { in: nonFixture } } }),
    ]);
    const tenantsWithPayables = new Set(
      (await tx.employeeTipPayable.findMany({ where: { businessId: { in: nonFixture } }, select: { businessId: true }, distinct: ["businessId"] })).map((r) => r.businessId),
    );
    console.log("\n=== Lifecycle coverage outside fixture tenants (aggregate) ===");
    console.log(`  businesses: total ${businesses.length}, fixture ${fixtureBiz.size}, non-fixture ${nonFixture.length} (with payables: ${tenantsWithPayables.size})`);
    console.log(`  success tips: ${tipsSuccess}  payables with stripe_transfer_id: ${realTransfers}  disputed payables: ${disputedPayables}`);
    console.log(`  distribution batches: ${batches}  allocations: ${allocations}  connect payouts: ${connectPayouts}`);
    for (const s of payableStates) console.log(`  payable ${s.routingMode}/${s.chargeModel}/${s.status}: ${s._count._all}`);
    for (const s of refundStates) console.log(`  tip_refund ${s.kind}/${s.status}: ${s._count._all}`);

    return out;
  },
  { timeout: 120_000, maxWait: 20_000 },
);

await prisma.$disconnect();

const order: Evidence["classification"][] = ["confirmed fixture", "probable fixture", "inconclusive", "legitimate/unknown"];
const bySet = new Map<string, Evidence[]>();
for (const e of evidence) bySet.set(e.set, [...(bySet.get(e.set) ?? []), e]);

console.log("\n=== Classification by flagged set ===");
for (const [set, rows] of bySet) {
  const counts = order.map((c) => `${c}: ${rows.filter((r) => r.classification === c).length}`).join(" | ");
  console.log(`\n${set} (${rows.length})  ${counts}`);
  const suites = new Map<string, number>();
  for (const r of rows) if (r.suite) suites.set(r.suite, (suites.get(r.suite) ?? 0) + 1);
  if (suites.size) console.log(`  suites: ${[...suites.entries()].map(([s, n]) => `${s}=${n}`).join(", ")}`);
  const inventorySet = set === "has_stripe_transfer_id" || set === "frozen_fee_differs_from_formula";
  const shown = inventorySet ? rows.filter((r) => r.classification !== "confirmed fixture") : rows;
  for (const r of shown.slice(0, 40)) {
    console.log(
      `  ${r.recordId}  created=${r.recordCreatedAt.slice(0, 16)}  biz=${r.businessId ?? "-"}  ${r.classification}` +
        `  [acct=${r.acct} pi=${r.pi} tr=${r.tr} mgr=${r.managerEmail}${r.transferErrorPrefix ? ` err=${r.transferErrorPrefix}` : ""}]  ${r.reason}`,
    );
  }
  if (shown.length > 40) console.log(`  ... ${shown.length - 40} more in detail file`);
}

const overall = new Map<string, Evidence>();
for (const e of evidence) if (e.set !== "has_stripe_transfer_id") overall.set(e.recordId, e);
console.log("\n=== Distinct flagged records (excluding transfer-id inventory) ===");
for (const c of order) console.log(`  ${c}: ${[...overall.values()].filter((e) => e.classification === c).length}`);

const detailPath = join(tmpdir(), `caretip-phase2-fixture-investigation-${Date.now()}.json`);
writeFileSync(detailPath, JSON.stringify(evidence, null, 2));
console.log(`\nDetail (internal ids + labels only): ${detailPath}`);
