/**
 * Read-only business-facing reconciliation between CareTip ledger and Stripe.
 * Does not mutate ledger or Stripe state.
 */
import { EmployeeTipChargeModel, EmployeeTipPayoutMode, EmployeeTipPayableStatus } from "@prisma/client";
import type Stripe from "stripe";
import { prisma } from "../prisma.js";
import { getStripeClient, isStripeConfigured } from "./stripe.service.js";
import { remainingPayableCents } from "./employeeTipPayable.service.js";

export type BusinessReconciliationStatus =
  | "MATCHED"
  | "PENDING"
  | "MISMATCH"
  | "BUSINESS_DISTRIBUTION";

export type BusinessReconciliationRow = {
  payableId: string;
  transactionId: string;
  status: BusinessReconciliationStatus;
  routingMode: string;
  caretipGrossCents: number;
  caretipRemainingCents: number;
  caretipStatus: string;
  stripeChargeId: string | null;
  stripePaymentIntentId: string | null;
};

type ListTransfersFn = (
  params: Stripe.TransferListParams,
) => Promise<Stripe.ApiList<Stripe.Transfer>>;

let listTransfersFnForTests: ListTransfersFn | null = null;

export function __setBusinessStripeTransferListFnForTests(fn: ListTransfersFn | null): void {
  listTransfersFnForTests = fn;
}

function classifyBusinessPayableRow(
  row: {
    id: string;
    transactionId: string;
    routingMode: string;
    status: string;
    grossCents: number;
    payableCents: number;
    transferredCents: number;
    reversedCents: number;
    refundedCents: number;
    disputedOpenCents: number;
    disputedLostCents: number;
    stripeChargeId: string | null;
    stripePaymentIntentId: string | null;
    chargeModel: string;
  },
  stripeChargeIds: Set<string>,
): BusinessReconciliationRow {
  const remaining = remainingPayableCents(row);
  const base: BusinessReconciliationRow = {
    payableId: row.id,
    transactionId: row.transactionId,
    status: "PENDING",
    routingMode: row.routingMode,
    caretipGrossCents: row.grossCents,
    caretipRemainingCents: remaining,
    caretipStatus: row.status,
    stripeChargeId: row.stripeChargeId,
    stripePaymentIntentId: row.stripePaymentIntentId,
  };

  if (row.routingMode === EmployeeTipPayoutMode.business_distribution) {
    return {
      ...base,
      status: "BUSINESS_DISTRIBUTION",
    };
  }

  if (row.routingMode === EmployeeTipPayoutMode.direct_to_employee) {
    return {
      ...base,
      status: "MATCHED",
    };
  }

  if (
    row.chargeModel === EmployeeTipChargeModel.destination_business &&
    row.stripeChargeId &&
    stripeChargeIds.has(row.stripeChargeId)
  ) {
    return { ...base, status: "MATCHED" };
  }

  if (
    row.status === EmployeeTipPayableStatus.held_business ||
    row.status === EmployeeTipPayableStatus.destination_settled
  ) {
    return { ...base, status: row.stripeChargeId ? "PENDING" : "MISMATCH" };
  }

  return base;
}

export async function reconcileBusinessPayables(
  businessId: string,
): Promise<{
  rows: BusinessReconciliationRow[];
  needsAttention: boolean;
  stripeReadable: boolean;
}> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { stripeAccountId: true },
  });
  const stripeAccountId = business?.stripeAccountId?.trim() ?? "";

  const payables = await prisma.employeeTipPayable.findMany({
    where: { businessId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      transactionId: true,
      routingMode: true,
      chargeModel: true,
      status: true,
      grossCents: true,
      payableCents: true,
      transferredCents: true,
      reversedCents: true,
      refundedCents: true,
      disputedOpenCents: true,
      disputedLostCents: true,
      stripeChargeId: true,
      stripePaymentIntentId: true,
    },
  });

  const stripeChargeIds = new Set<string>();
  let stripeReadable = false;

  if (stripeAccountId.startsWith("acct_") && (isStripeConfigured() || listTransfersFnForTests)) {
    try {
      const stripe = getStripeClient();
      const charges = await stripe.charges.list(
        { limit: 100 },
        { stripeAccount: stripeAccountId },
      );
      stripeReadable = true;
      for (const ch of charges.data) {
        if (ch.id) stripeChargeIds.add(ch.id);
      }
    } catch {
      stripeReadable = false;
    }
  }

  const rows = payables.map((row) => classifyBusinessPayableRow(row, stripeChargeIds));
  const needsAttention = rows.some(
    (r) => r.status === "MISMATCH" || r.status === "PENDING",
  );

  return { rows, needsAttention, stripeReadable };
}
