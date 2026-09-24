/**
 * Read-only CareTip ↔ Stripe transfer reconciliation for direct employee payables.
 * Does not mutate ledger or Stripe state.
 */
import { EmployeeTipPayoutMode } from "@prisma/client";
import type Stripe from "stripe";
import { prisma } from "../prisma.js";
import { isStripeConfigured, getStripeClient } from "./stripe.service.js";
import { remainingPayableCents } from "./employeeTipPayable.service.js";

export type PayableReconciliationStatus =
  | "MATCHED"
  | "CARETIP_PENDING"
  | "STRIPE_TRANSFER_FOUND"
  | "AMOUNT_MISMATCH"
  | "DESTINATION_MISMATCH"
  | "DUPLICATE_TRANSFER";

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
  stripeDestination: string | null;
  employeeStripeAccountId: string | null;
};

type ListTransfersFn = (
  params: Stripe.TransferListParams,
) => Promise<Stripe.ApiList<Stripe.Transfer>>;

let listTransfersFnForTests: ListTransfersFn | null = null;

export function __setEmployeeStripeTransferListFnForTests(fn: ListTransfersFn | null): void {
  listTransfersFnForTests = fn;
}

function classifyPayableRow(
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
  },
  stripeById: Map<string, Stripe.Transfer>,
  stripeByPayableMeta: Map<string, Stripe.Transfer[]>,
  employeeStripeAccountId: string | null,
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
    stripeDestination: null,
    employeeStripeAccountId,
  };

  const metaMatches = stripeByPayableMeta.get(row.id) ?? [];
  const linked =
    (row.stripeTransferId ? stripeById.get(row.stripeTransferId) : null) ??
    (metaMatches.length === 1 ? metaMatches[0] : null);

  if (metaMatches.length > 1) {
    return { ...base, status: "DUPLICATE_TRANSFER" };
  }

  if (!linked) {
    if (row.status === "transferred" || row.transferredCents > 0) {
      return { ...base, status: "STRIPE_TRANSFER_FOUND" };
    }
    return base;
  }

  const dest =
    typeof linked.destination === "string" ? linked.destination : linked.destination?.id ?? null;
  base.stripeTransferId = linked.id;
  base.stripeTransferAmountCents = linked.amount;
  base.stripeDestination = dest;

  if (employeeStripeAccountId && dest && dest !== employeeStripeAccountId) {
    return { ...base, status: "DESTINATION_MISMATCH" };
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

export async function reconcileEmployeeDirectPayables(
  employeeId: string,
): Promise<{
  rows: PayableReconciliationRow[];
  needsAttention: boolean;
  stripeReadable: boolean;
}> {
  const account = await prisma.employeeStripeAccount.findUnique({
    where: { employeeId },
    select: { stripeAccountId: true },
  });
  const employeeStripeAccountId = account?.stripeAccountId?.trim() ?? null;

  const payables = await prisma.employeeTipPayable.findMany({
    where: {
      employeeId,
      routingMode: EmployeeTipPayoutMode.direct_to_employee,
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      transactionId: true,
      status: true,
      payableCents: true,
      transferredCents: true,
      reversedCents: true,
      refundedCents: true,
      disputedOpenCents: true,
      disputedLostCents: true,
      stripeTransferId: true,
      stripeDestinationAccountId: true,
    },
  });

  const stripeById = new Map<string, Stripe.Transfer>();
  const stripeByPayableMeta = new Map<string, Stripe.Transfer[]>();
  let stripeReadable = false;

  if (employeeStripeAccountId?.startsWith("acct_") && (isStripeConfigured() || listTransfersFnForTests)) {
    try {
      const list = listTransfersFnForTests
        ? await listTransfersFnForTests({ destination: employeeStripeAccountId, limit: 100 })
        : await getStripeClient().transfers.list({
            destination: employeeStripeAccountId,
            limit: 100,
          });
      stripeReadable = true;
      for (const tr of list.data) {
        stripeById.set(tr.id, tr);
        const payableId = tr.metadata?.caretip_payable_id?.trim();
        if (payableId) {
          const arr = stripeByPayableMeta.get(payableId) ?? [];
          arr.push(tr);
          stripeByPayableMeta.set(payableId, arr);
        }
      }
    } catch {
      stripeReadable = false;
    }
  }

  const rows = payables.map((row) =>
    classifyPayableRow(row, stripeById, stripeByPayableMeta, employeeStripeAccountId),
  );
  const needsAttention = rows.some((r) =>
    r.status === "STRIPE_TRANSFER_FOUND" ||
    r.status === "AMOUNT_MISMATCH" ||
    r.status === "DESTINATION_MISMATCH" ||
    r.status === "DUPLICATE_TRANSFER",
  );

  return { rows, needsAttention, stripeReadable };
}
