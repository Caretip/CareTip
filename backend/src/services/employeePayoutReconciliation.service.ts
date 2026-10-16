/**
 * Read-only CareTip ↔ Stripe transfer reconciliation for direct employee payables.
 * Does not mutate ledger or Stripe state.
 */
import { EmployeeTipChargeModel, EmployeeTipPayoutMode } from "@prisma/client";
import type Stripe from "stripe";
import { prisma } from "../prisma.js";
import { isStripeConfigured, getStripeClient } from "./stripe.service.js";
import { remainingPayableCents } from "./employeeTipPayable.service.js";

export type PayableReconciliationStatus =
  | "MATCHED"
  | "CARETIP_PENDING"
  | "STRIPE_TRANSFER_MISSING"
  | "STRIPE_VERIFICATION_INCOMPLETE"
  | "AMOUNT_MISMATCH"
  | "DESTINATION_MISMATCH"
  | "DUPLICATE_TRANSFER";

const RECONCILIATION_PAGE_SIZE = 100;
/** Upper bound on Stripe transfer pages read per destination account per reconciliation. */
export const RECONCILIATION_MAX_TRANSFER_PAGES = 10;
/** Destination-charge transfers are created before the payable row; widen the `created` window. */
const TRANSFER_CREATED_SLACK_SECONDS = 86_400;

const ATTENTION_STATUSES = new Set<PayableReconciliationStatus>([
  "STRIPE_TRANSFER_MISSING",
  "AMOUNT_MISMATCH",
  "DESTINATION_MISMATCH",
  "DUPLICATE_TRANSFER",
]);

export type PayableReconciliationRow = {
  payableId: string;
  transactionId: string;
  status: PayableReconciliationStatus;
  caretipPayableCents: number;
  caretipTransferredCents: number;
  caretipRemainingCents: number;
  caretipStatus: string;
  stripeTransferId: string | null;
  stripeTransferAmountCents: number | null;
  /** Stripe Transfer `created` when a transfer was linked during reconciliation. */
  stripeTransferCreatedAt: string | null;
  stripeDestination: string | null;
  employeeStripeAccountId: string | null;
};

export type ListTransfersFn = (
  params: Stripe.TransferListParams,
) => Promise<Stripe.ApiList<Stripe.Transfer>>;

let listTransfersFnForTests: ListTransfersFn | null = null;

export function __setEmployeeStripeTransferListFnForTests(fn: ListTransfersFn | null): void {
  listTransfersFnForTests = fn;
}

export type StripeTransferIndex = {
  byId: Map<string, Stripe.Transfer>;
  byPayableMeta: Map<string, Stripe.Transfer[]>;
  /** Destination-charge transfers keyed by `source_transaction` (platform charge id). */
  bySourceCharge: Map<string, Stripe.Transfer>;
};

export function newStripeTransferIndex(): StripeTransferIndex {
  return { byId: new Map(), byPayableMeta: new Map(), bySourceCharge: new Map() };
}

function addTransferToIndex(index: StripeTransferIndex, tr: Stripe.Transfer): void {
  index.byId.set(tr.id, tr);
  const payableId = tr.metadata?.caretip_payable_id?.trim();
  if (payableId) {
    const arr = index.byPayableMeta.get(payableId) ?? [];
    if (!arr.some((t) => t.id === tr.id)) arr.push(tr);
    index.byPayableMeta.set(payableId, arr);
  }
  const source =
    typeof tr.source_transaction === "string" ? tr.source_transaction : tr.source_transaction?.id ?? null;
  if (source) index.bySourceCharge.set(source, tr);
}

/**
 * Reads transfers to one connected account into `index`, paginating up to
 * RECONCILIATION_MAX_TRANSFER_PAGES. Throws when Stripe cannot be read; `hasMore` means the bound was hit.
 */
export async function indexTransfersForDestination(
  index: StripeTransferIndex,
  list: ListTransfersFn,
  destination: string,
  createdGteUnix: number | null,
): Promise<{ hasMore: boolean }> {
  let startingAfter: string | undefined;
  for (let page = 0; page < RECONCILIATION_MAX_TRANSFER_PAGES; page += 1) {
    const res = await list({
      destination,
      limit: RECONCILIATION_PAGE_SIZE,
      ...(createdGteUnix != null ? { created: { gte: createdGteUnix } } : {}),
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    for (const tr of res.data) addTransferToIndex(index, tr);
    if (!res.has_more || res.data.length === 0) return { hasMore: false };
    startingAfter = res.data[res.data.length - 1].id;
  }
  return { hasMore: true };
}

export function transferListCreatedGte(oldestPayableCreatedAt: Date | null | undefined): number | null {
  if (!oldestPayableCreatedAt) return null;
  return Math.floor(oldestPayableCreatedAt.getTime() / 1000) - TRANSFER_CREATED_SLACK_SECONDS;
}

export function classifyPayableRow(
  row: {
    id: string;
    transactionId: string;
    status: string;
    payableCents: number;
    transferredCents: number;
    reversedCents: number;
    refundedCents: number;
    disputedOpenCents: number;
    disputedLostCents: number;
    stripeTransferId: string | null;
    stripeDestinationAccountId: string | null;
    chargeModel?: string;
    grossCents?: number;
    stripeChargeId?: string | null;
  },
  stripeById: Map<string, Stripe.Transfer>,
  stripeByPayableMeta: Map<string, Stripe.Transfer[]>,
  employeeStripeAccountId: string | null,
  opts?: {
    stripeBySourceCharge?: Map<string, Stripe.Transfer>;
    /** False when Stripe was unreadable or the transfer listing was truncated. Default true. */
    lookupComplete?: boolean;
  },
): PayableReconciliationRow {
  const remaining = remainingPayableCents(row);
  const base: PayableReconciliationRow = {
    payableId: row.id,
    transactionId: row.transactionId,
    status: "CARETIP_PENDING",
    caretipPayableCents: row.payableCents,
    caretipTransferredCents: row.transferredCents,
    caretipRemainingCents: remaining,
    caretipStatus: row.status,
    stripeTransferId: row.stripeTransferId,
    stripeTransferAmountCents: null,
    stripeTransferCreatedAt: null,
    stripeDestination: null,
    employeeStripeAccountId,
  };

  // Destination charges: Stripe creates one automatic Transfer of the gross amount per charge; it
  // carries no CareTip metadata and the application fee is collected separately.
  const destinationCharge = row.chargeModel === EmployeeTipChargeModel.destination_employee;
  const metaMatches = destinationCharge ? [] : stripeByPayableMeta.get(row.id) ?? [];
  const bySource =
    destinationCharge && row.stripeChargeId ? opts?.stripeBySourceCharge?.get(row.stripeChargeId) ?? null : null;
  const linked =
    (row.stripeTransferId ? stripeById.get(row.stripeTransferId) : null) ??
    bySource ??
    (metaMatches.length === 1 ? metaMatches[0] : null);

  if (metaMatches.length > 1) {
    return { ...base, status: "DUPLICATE_TRANSFER" };
  }

  if (!linked) {
    if (row.status === "transferred" || row.transferredCents > 0) {
      const lookupComplete = opts?.lookupComplete ?? true;
      const linkable = !destinationCharge || Boolean(row.stripeTransferId || row.stripeChargeId);
      return { ...base, status: lookupComplete && linkable ? "STRIPE_TRANSFER_MISSING" : "STRIPE_VERIFICATION_INCOMPLETE" };
    }
    return base;
  }

  const dest =
    typeof linked.destination === "string" ? linked.destination : linked.destination?.id ?? null;
  base.stripeTransferId = linked.id;
  base.stripeTransferAmountCents = linked.amount;
  base.stripeTransferCreatedAt =
    typeof linked.created === "number" && linked.created > 0
      ? new Date(linked.created * 1000).toISOString()
      : null;
  base.stripeDestination = dest;

  if (employeeStripeAccountId && dest && dest !== employeeStripeAccountId) {
    return { ...base, status: "DESTINATION_MISMATCH" };
  }
  if (destinationCharge) {
    return { ...base, status: row.grossCents != null && linked.amount === row.grossCents ? "MATCHED" : "AMOUNT_MISMATCH" };
  }
  if (linked.amount !== row.transferredCents && row.transferredCents > 0) {
    return { ...base, status: "AMOUNT_MISMATCH" };
  }
  if (row.status === "transferred" && row.transferredCents > 0) {
    return { ...base, status: "MATCHED" };
  }
  if (linked.amount === row.payableCents || linked.amount === remaining) {
    return { ...base, status: "MATCHED" };
  }
  return { ...base, status: "AMOUNT_MISMATCH" };
}

export type EmployeeReconciliationResult = {
  rows: PayableReconciliationRow[];
  needsAttention: boolean;
  stripeReadable: boolean;
  complete: boolean;
  examinedPayableCount: number;
  totalPayableCount: number;
  payablesTruncated: boolean;
  transfersHasMore: boolean;
  /** Server time when this reconciliation snapshot was produced. */
  checkedAt: string;
};

export async function reconcileEmployeeDirectPayables(
  employeeId: string,
): Promise<EmployeeReconciliationResult> {
  const account = await prisma.employeeStripeAccount.findUnique({
    where: { employeeId },
    select: { stripeAccountId: true },
  });
  const employeeStripeAccountId = account?.stripeAccountId?.trim() ?? null;

  const payableWhere = {
    employeeId,
    routingMode: EmployeeTipPayoutMode.direct_to_employee,
  };

  const totalPayableCount = await prisma.employeeTipPayable.count({ where: payableWhere });

  const payables = await prisma.employeeTipPayable.findMany({
    where: payableWhere,
    orderBy: { createdAt: "desc" },
    take: RECONCILIATION_PAGE_SIZE,
    select: {
      id: true,
      transactionId: true,
      status: true,
      chargeModel: true,
      grossCents: true,
      payableCents: true,
      transferredCents: true,
      reversedCents: true,
      refundedCents: true,
      disputedOpenCents: true,
      disputedLostCents: true,
      stripeChargeId: true,
      stripeTransferId: true,
      stripeDestinationAccountId: true,
      createdAt: true,
    },
  });

  const index = newStripeTransferIndex();
  let stripeReadable = false;
  let transfersHasMore = false;

  if (employeeStripeAccountId?.startsWith("acct_") && (isStripeConfigured() || listTransfersFnForTests)) {
    const list: ListTransfersFn =
      listTransfersFnForTests ?? ((params) => getStripeClient().transfers.list(params));
    try {
      const page = await indexTransfersForDestination(
        index,
        list,
        employeeStripeAccountId,
        transferListCreatedGte(payables[payables.length - 1]?.createdAt),
      );
      stripeReadable = true;
      transfersHasMore = page.hasMore;
    } catch {
      stripeReadable = false;
    }
  }

  const lookupComplete = stripeReadable && !transfersHasMore;
  const rows = payables.map((row) =>
    classifyPayableRow(row, index.byId, index.byPayableMeta, employeeStripeAccountId, {
      stripeBySourceCharge: index.bySourceCharge,
      lookupComplete,
    }),
  );
  const payablesTruncated = totalPayableCount > payables.length;
  const complete =
    !payablesTruncated && !transfersHasMore && !rows.some((r) => r.status === "STRIPE_VERIFICATION_INCOMPLETE");
  const needsAttention =
    rows.some((r) => {
      if (!ATTENTION_STATUSES.has(r.status)) return false;
      if (!stripeReadable && r.status === "STRIPE_TRANSFER_MISSING") return false;
      return true;
    });

  return {
    rows,
    needsAttention,
    stripeReadable,
    complete,
    examinedPayableCount: rows.length,
    totalPayableCount,
    payablesTruncated,
    transfersHasMore,
    checkedAt: new Date().toISOString(),
  };
}
