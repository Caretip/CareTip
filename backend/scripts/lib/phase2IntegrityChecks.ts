/**
 * Phase 2 financial integrity checks (read-only SQL), shared by the scan and the detector tests.
 * `businessIds` limits every tenant-owned check to those businesses; webhook checks are global.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { calculateTipPlatformFeeCents } from "../../src/config/fees.js";
import { DURABLE_RELEASE_BLOCK_PREFIX } from "../../src/lib/employeeTipReleaseClaim.js";
import {
  AGED_HELD_BUSINESS_DAYS_DEFAULT,
  scanBusinessDistributionLedgerWithCoverage,
} from "../../src/services/businessDistributionIntegrity.service.js";

export const LEDGER_MIGRATION = "20260910080000_employee_tip_direct_payout_ledger";
export const STALE_PENDING_HOURS = 24;
export const STALE_TRANSFERRING_MINUTES = 60;

/**
 * defect = invariant violated; investigate = needs evidence before calling it a defect;
 * lifecycle / legacy / uncertain = legitimate states reported for visibility, never defects.
 */
export type FindingClass = "defect" | "investigate" | "expected-lifecycle" | "expected-legacy" | "uncertain";

export type Finding = {
  area: number;
  key: string;
  label: string;
  classification: FindingClass;
  ids: string[];
};

type Db = Pick<PrismaClient, "$queryRaw">;

export async function ledgerStartedAt(db: Db): Promise<Date | null> {
  const rows = await db.$queryRaw<{ finished_at: Date | null }[]>`
    SELECT finished_at FROM _prisma_migrations WHERE migration_name = ${LEDGER_MIGRATION}`;
  return rows[0]?.finished_at ?? null;
}

export async function runIntegrityChecks(
  db: Db,
  opts: { businessIds: string[] | null; ledgerStartAt: Date | null },
): Promise<Finding[]> {
  const ids = opts.businessIds;
  const scope = (column: string) =>
    ids ? Prisma.sql`AND ${Prisma.raw(column)} = ANY(${ids}::text[])` : Prisma.empty;
  const findings: Finding[] = [];
  const add = async (
    area: number,
    key: string,
    label: string,
    classification: FindingClass,
    query: Promise<{ id: string }[]>,
  ) => {
    findings.push({ area, key, label, classification, ids: (await query).map((r) => r.id) });
  };

  // 1. Successful eligible tips ↔ payables
  if (opts.ledgerStartAt) {
    await add(1, "missing_payable_post_ledger", "success tip with employee but no payable (after ledger introduced)", "investigate",
      db.$queryRaw`SELECT t.id FROM tips t LEFT JOIN employee_tip_payables p ON p.transaction_id = t.id
        WHERE t.status = 'success' AND t.employee_id IS NOT NULL AND p.id IS NULL
          AND t.created_at >= ${opts.ledgerStartAt} ${scope("t.business_id")} ORDER BY t.created_at`);
    await add(1, "missing_payable_pre_ledger", "success tip without payable (pre-ledger history)", "expected-legacy",
      db.$queryRaw`SELECT t.id FROM tips t LEFT JOIN employee_tip_payables p ON p.transaction_id = t.id
        WHERE t.status = 'success' AND t.employee_id IS NOT NULL AND p.id IS NULL
          AND t.created_at < ${opts.ledgerStartAt} ${scope("t.business_id")}`);
  }
  await add(1, "payable_on_non_success_tip", "payable whose tip is not success", "investigate",
    db.$queryRaw`SELECT p.id FROM employee_tip_payables p JOIN tips t ON t.id = p.transaction_id
      WHERE t.status <> 'success' ${scope("p.business_id")}`);

  // 2. Duplicate payables / financial effects (tip PI, payable-per-tip and transfer id are UNIQUE)
  await add(2, "duplicate_charge_across_payables", "same Stripe charge on more than one payable", "defect",
    db.$queryRaw`SELECT p.id FROM employee_tip_payables p
      JOIN (SELECT stripe_charge_id FROM employee_tip_payables WHERE stripe_charge_id IS NOT NULL
            GROUP BY stripe_charge_id HAVING COUNT(*) > 1) d ON d.stripe_charge_id = p.stripe_charge_id
      WHERE TRUE ${scope("p.business_id")}`);
  await add(2, "duplicate_pi_across_payables", "same PaymentIntent on more than one payable", "defect",
    db.$queryRaw`SELECT p.id FROM employee_tip_payables p
      JOIN (SELECT stripe_payment_intent_id FROM employee_tip_payables
            GROUP BY stripe_payment_intent_id HAVING COUNT(*) > 1) d ON d.stripe_payment_intent_id = p.stripe_payment_intent_id
      WHERE TRUE ${scope("p.business_id")}`);

  // 3. Gross / fee / net / frozen fee
  await add(3, "negative_or_zero_cents", "payable with negative/zero cent fields", "defect",
    db.$queryRaw`SELECT p.id FROM employee_tip_payables p
      WHERE (p.gross_cents <= 0 OR p.platform_fee_cents < 0 OR p.payable_cents <= 0 OR p.transferred_cents < 0
         OR p.reversed_cents < 0 OR p.refunded_cents < 0 OR p.disputed_open_cents < 0 OR p.disputed_lost_cents < 0)
        ${scope("p.business_id")}`);
  await add(3, "payable_split_broken", "payable_cents != gross_cents - platform_fee_cents", "defect",
    db.$queryRaw`SELECT p.id FROM employee_tip_payables p
      WHERE p.payable_cents <> p.gross_cents - p.platform_fee_cents ${scope("p.business_id")}`);
  await add(3, "gross_differs_from_tip", "payable gross_cents != tip amount", "investigate",
    db.$queryRaw`SELECT p.id FROM employee_tip_payables p JOIN tips t ON t.id = p.transaction_id
      WHERE p.gross_cents <> ROUND(t.amount * 100)::int ${scope("p.business_id")}`);
  const feeRows = await db.$queryRaw<{ id: string; gross_cents: number; platform_fee_cents: number }[]>`
    SELECT p.id, p.gross_cents, p.platform_fee_cents FROM employee_tip_payables p WHERE TRUE ${scope("p.business_id")}`;
  findings.push({
    area: 3,
    key: "frozen_fee_differs_from_formula",
    label: "frozen platform fee differs from the current fee formula (fee is frozen at payment time)",
    classification: "investigate",
    ids: feeRows
      .filter((r) => {
        try {
          return calculateTipPlatformFeeCents(r.gross_cents) !== r.platform_fee_cents;
        } catch {
          return true;
        }
      })
      .map((r) => r.id),
  });

  // 4. Destination / transfer consistency (DB side)
  await add(4, "transferred_exceeds_payable", "transferred_cents > payable_cents", "defect",
    db.$queryRaw`SELECT p.id FROM employee_tip_payables p
      WHERE p.transferred_cents > p.payable_cents ${scope("p.business_id")}`);
  await add(4, "status_inconsistent_with_charge_model", "payable status inconsistent with charge model", "investigate",
    db.$queryRaw`SELECT p.id FROM employee_tip_payables p
      WHERE ((p.charge_model = 'destination_business' AND p.status NOT IN ('held_business','refunded'))
         OR (p.charge_model = 'destination_employee' AND p.status NOT IN ('destination_settled','refunded'))
         OR (p.status = 'held_business' AND p.charge_model <> 'destination_business'))
        ${scope("p.business_id")}`);
  await add(4, "transferred_without_transfer_id", "status transferred without stripe_transfer_id", "defect",
    db.$queryRaw`SELECT p.id FROM employee_tip_payables p
      WHERE p.status = 'transferred' AND p.stripe_transfer_id IS NULL ${scope("p.business_id")}`);
  await add(4, "destination_employee_account_changed", "destination_employee payable destination != current employee account", "investigate",
    db.$queryRaw`SELECT p.id FROM employee_tip_payables p JOIN employee_stripe_accounts a ON a.employee_id = p.employee_id
      WHERE p.charge_model = 'destination_employee' AND p.stripe_destination_account_id IS NOT NULL
        AND p.stripe_destination_account_id <> a.stripe_account_id ${scope("p.business_id")}`);

  // 5. Allocations
  await add(5, "item_allocations_differ_from_item", "distribution item allocations != item amount", "defect",
    db.$queryRaw`SELECT i.id FROM employee_tip_distribution_items i
      JOIN (SELECT item_id, SUM(amount_cents)::int AS s FROM employee_tip_distribution_allocations GROUP BY item_id) x
        ON x.item_id = i.id
      WHERE x.s <> i.amount_cents ${scope("i.business_id")}`);
  await add(5, "allocated_above_remaining_after_refund", "allocated above remaining after later refund/dispute", "expected-lifecycle",
    db.$queryRaw`SELECT p.id FROM employee_tip_payables p
      JOIN (SELECT employee_tip_payable_id, SUM(amount_cents)::int AS s
            FROM employee_tip_distribution_allocations GROUP BY employee_tip_payable_id) x
        ON x.employee_tip_payable_id = p.id
      WHERE x.s <= p.payable_cents
        AND x.s > GREATEST(p.payable_cents - p.transferred_cents - p.reversed_cents - p.refunded_cents
                           - p.disputed_open_cents - p.disputed_lost_cents, 0) ${scope("p.business_id")}`);

  // 6. Refunds
  const refundCents = Prisma.sql`(SELECT tip_id, ROUND(SUM(amount_eur) * 100)::int AS cents FROM tip_refunds
      WHERE kind = 'refund' AND status = 'succeeded' AND tip_id IS NOT NULL GROUP BY tip_id)`;
  await add(6, "refunds_exceed_tip", "succeeded refunds exceed tip amount", "defect",
    db.$queryRaw`SELECT t.id FROM tips t JOIN ${refundCents} r ON r.tip_id = t.id
      WHERE r.cents > ROUND(t.amount * 100)::int ${scope("t.business_id")}`);
  await add(6, "refund_tenant_mismatch", "refund business != tip business", "defect",
    db.$queryRaw`SELECT r.id FROM tip_refunds r JOIN tips t ON t.id = r.tip_id
      WHERE r.business_id <> t.business_id ${scope("t.business_id")}`);
  await add(6, "refund_non_eur", "non-EUR refund row", "investigate",
    db.$queryRaw`SELECT r.id FROM tip_refunds r WHERE LOWER(r.currency) <> 'eur' ${scope("r.business_id")}`);
  await add(6, "payable_refunded_without_refund_row", "payable refunded_cents > 0 without succeeded refund row", "investigate",
    db.$queryRaw`SELECT p.id FROM employee_tip_payables p LEFT JOIN ${refundCents} r ON r.tip_id = p.transaction_id
      WHERE p.refunded_cents > 0 AND r.tip_id IS NULL ${scope("p.business_id")}`);
  await add(6, "payable_refunded_exceeds_refund_rows", "payable refunded_cents above succeeded refund total", "defect",
    db.$queryRaw`SELECT p.id FROM employee_tip_payables p JOIN ${refundCents} r ON r.tip_id = p.transaction_id
      WHERE p.refunded_cents > r.cents ${scope("p.business_id")}`);
  await add(6, "refund_rows_not_applied", "succeeded refund rows but payable refunded_cents = 0", "investigate",
    db.$queryRaw`SELECT p.id FROM employee_tip_payables p JOIN ${refundCents} r ON r.tip_id = p.transaction_id
      WHERE r.cents > 0 AND p.refunded_cents = 0 ${scope("p.business_id")}`);

  // 7. Disputes
  await add(7, "dispute_exposure_exceeds_payable", "refunded + disputed cents exceed payable", "defect",
    db.$queryRaw`SELECT p.id FROM employee_tip_payables p
      WHERE p.refunded_cents + p.disputed_open_cents + p.disputed_lost_cents > p.payable_cents ${scope("p.business_id")}`);
  await add(7, "payable_disputed_without_dispute_row", "payable disputed cents without a dispute row for the tip", "investigate",
    db.$queryRaw`SELECT p.id FROM employee_tip_payables p
      WHERE (p.disputed_open_cents > 0 OR p.disputed_lost_cents > 0)
        AND NOT EXISTS (SELECT 1 FROM tip_refunds r WHERE r.tip_id = p.transaction_id AND r.kind IN ('dispute','chargeback'))
        ${scope("p.business_id")}`);
  await add(7, "lost_dispute_not_on_payable", "lost dispute row but payable disputed_lost_cents = 0", "investigate",
    db.$queryRaw`SELECT DISTINCT p.id FROM employee_tip_payables p
      JOIN tip_refunds r ON r.tip_id = p.transaction_id AND r.kind IN ('dispute','chargeback') AND r.status = 'lost'
      WHERE p.disputed_lost_cents = 0 ${scope("p.business_id")}`);
  await add(7, "open_dispute_exposure", "payable with open dispute exposure", "expected-lifecycle",
    db.$queryRaw`SELECT p.id FROM employee_tip_payables p WHERE p.disputed_open_cents > 0 ${scope("p.business_id")}`);

  // 8 + 10. Business distribution / platform holds / tenant isolation (service scanner, per business)
  // success_transaction_missing_payable is omitted: area 1 reports it split at the ledger introduction.
  const bdCodes: Record<string, { area: number; classification: FindingClass; label: string }> = {
    anomalous_platform_hold_business_distribution: { area: 8, classification: "investigate", label: "platform_hold payable in business_distribution" },
    aged_held_business: { area: 8, classification: "expected-lifecycle", label: `held_business balance older than ${AGED_HELD_BUSINESS_DAYS_DEFAULT}d (operational)` },
    distribution_allocation_exceeds_payable: { area: 5, classification: "defect", label: "allocations exceed payable_cents" },
    distribution_allocation_tenant_mismatch: { area: 10, classification: "defect", label: "allocation recorded under another business" },
    employee_business_mismatch: { area: 10, classification: "defect", label: "employee/business mismatch on tip or payable" },
    payable_destination_mismatch: { area: 4, classification: "investigate", label: "payable destination != business/employee account" },
    payable_charge_model_mismatch: { area: 4, classification: "investigate", label: "charge model inconsistent with routing" },
    orphan_captured_payment_intent: { area: 1, classification: "investigate", label: "captured PI without tip" },
  };
  const bdIds = new Map<string, string[]>();
  let bdComplete = true;
  for (const businessId of ids ?? [undefined]) {
    const scan = await scanBusinessDistributionLedgerWithCoverage(businessId ? { businessId } : undefined);
    bdComplete &&= scan.coverage.complete;
    for (const issue of scan.issues) {
      const list = bdIds.get(issue.code) ?? [];
      list.push(issue.payableId ?? issue.transactionId ?? "-");
      bdIds.set(issue.code, list);
    }
  }
  for (const [code, meta] of Object.entries(bdCodes)) {
    findings.push({ area: meta.area, key: `bd_${code}`, label: meta.label, classification: meta.classification, ids: bdIds.get(code) ?? [] });
  }
  if (!bdComplete) {
    findings.push({ area: 8, key: "bd_scan_truncated", label: "business-distribution scan coverage truncated", classification: "uncertain", ids: ["coverage"] });
  }
  await add(10, "payable_tip_tenant_mismatch", "payable vs tip business/employee/PI mismatch", "defect",
    db.$queryRaw`SELECT p.id FROM employee_tip_payables p JOIN tips t ON t.id = p.transaction_id
      WHERE (t.business_id <> p.business_id
         OR (t.employee_id IS NOT NULL AND p.employee_id IS NOT NULL AND t.employee_id <> p.employee_id)
         OR (t.stripe_payment_intent_id IS NOT NULL AND t.stripe_payment_intent_id <> p.stripe_payment_intent_id))
        ${scope("p.business_id")}`);
  await add(10, "payable_employee_other_business", "payable employee belongs to another business", "investigate",
    db.$queryRaw`SELECT p.id FROM employee_tip_payables p JOIN employees e ON e.id = p.employee_id
      WHERE e.business_id <> p.business_id ${scope("p.business_id")}`);

  // 9. Stuck / uncertain / failed transfer recovery
  await add(9, "stale_pending_tip", `pending tip older than ${STALE_PENDING_HOURS}h (abandoned checkout or missed webhook)`, "investigate",
    db.$queryRaw`SELECT t.id FROM tips t WHERE t.status = 'pending'
      AND t.created_at < NOW() - make_interval(hours => ${STALE_PENDING_HOURS}::int) ${scope("t.business_id")}`);
  await add(9, "stale_transferring", `payable transferring > ${STALE_TRANSFERRING_MINUTES}min (reconciliation job should converge)`, "uncertain",
    db.$queryRaw`SELECT p.id FROM employee_tip_payables p WHERE p.status = 'transferring'
      AND p.updated_at < NOW() - make_interval(mins => ${STALE_TRANSFERRING_MINUTES}::int) ${scope("p.business_id")}`);
  await add(9, "durable_uncertain_marker", "payable blocked by durable uncertain-transfer marker", "uncertain",
    db.$queryRaw`SELECT p.id FROM employee_tip_payables p
      WHERE (p.last_transfer_error LIKE ${`${DURABLE_RELEASE_BLOCK_PREFIX}%`} OR p.last_transfer_error LIKE 'orphan_suspected:%')
        ${scope("p.business_id")}`);
  await add(9, "transfer_failed", "payable transfer_failed (retry/recovery path)", "expected-lifecycle",
    db.$queryRaw`SELECT p.id FROM employee_tip_payables p WHERE p.status = 'transfer_failed' ${scope("p.business_id")}`);

  // 12. Webhook processing (global)
  await add(12, "webhook_claim_expired", "webhook claim processing past expiry (next Stripe retry reclaims)", "uncertain",
    db.$queryRaw`SELECT id FROM stripe_webhook_events
      WHERE processing_result = 'processing' AND processing_claim_expires_at < NOW()`);
  await add(12, "webhook_processing_without_claim", "webhook row processing without claim token/expiry", "defect",
    db.$queryRaw`SELECT id FROM stripe_webhook_events
      WHERE processing_result = 'processing' AND (processing_claim_token IS NULL OR processing_claim_expires_at IS NULL)`);
  await add(12, "webhook_failed", "webhook event failed (awaiting Stripe retry)", "investigate",
    db.$queryRaw`SELECT id FROM stripe_webhook_events WHERE processing_result = 'failed'`);

  return findings;
}
