/**
 * Read-only business-facing reconciliation between CareTip ledger and Stripe.
 * Does not mutate ledger or Stripe state.
 */
import {
  EmployeeTipChargeModel,
  EmployeeTipPayoutMode,
  EmployeeTipPayableStatus,
} from "@prisma/client";
import type Stripe from "stripe";
import { prisma } from "../prisma.js";
import { getStripeClient, isStripeConfigured } from "./stripe.service.js";
import { remainingPayableCents } from "./employeeTipPayable.service.js";
import {
  classifyPayableRow,
  indexTransfersForDestination,
  newStripeTransferIndex,
  transferListCreatedGte,
  type ListTransfersFn,
  type PayableReconciliationStatus,
  type StripeTransferIndex,
} from "./employeePayoutReconciliation.service.js";

const RECONCILIATION_PAGE_SIZE = 100;

export type BusinessReconciliationStatus =
  | "MATCHED"
  | "BUSINESS_DISTRIBUTION"
  | "CARETIP_EXPECTED_PENDING"
  | "CARETIP_TRANSFER_FAILED"
  | "STRIPE_TRANSFER_MISSING"
  | "STRIPE_AMOUNT_MISMATCH"
  | "STRIPE_DESTINATION_MISMATCH"
  | "STRIPE_DUPLICATE_TRANSFER"
  | "INSUFFICIENT_VERIFICATION"
  | "CHARGE_MATCHED"
  | "CHARGE_PENDING"
  | "CHARGE_MISMATCH"
  | "PENDING"
  | "MISMATCH";

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
  stripeTransferId: string | null;
};

export type BusinessReconciliationResult = {
  rows: BusinessReconciliationRow[];
  needsAttention: boolean;
  stripeReadable: boolean;
  complete: boolean;
  examinedPayableCount: number;
  totalPayableCount: number;
  payablesTruncated: boolean;
  stripeExamination: {
    chargesExamined: number;
    chargesHasMore: boolean;
    transferDestinationsExamined: number;
    transfersHasMore: boolean;
  };
};

type ListChargesFn = (
  params: Stripe.ChargeListParams,
  opts?: { stripeAccount?: string },
) => Promise<Stripe.ApiList<Stripe.Charge>>;

let listTransfersFnForTests: ListTransfersFn | null = null;
let listChargesFnForTests: ListChargesFn | null = null;

export function __setBusinessStripeTransferListFnForTests(fn: ListTransfersFn | null): void {
  listTransfersFnForTests = fn;
}

export function __setBusinessStripeChargeListFnForTests(fn: ListChargesFn | null): void {
  listChargesFnForTests = fn;
}

function mapDirectTransferStatus(status: PayableReconciliationStatus): BusinessReconciliationStatus {
  switch (status) {
    case "MATCHED":
      return "MATCHED";
    case "CARETIP_PENDING":
      return "CARETIP_EXPECTED_PENDING";
    case "STRIPE_TRANSFER_MISSING":
      return "STRIPE_TRANSFER_MISSING";
    case "STRIPE_VERIFICATION_INCOMPLETE":
      return "INSUFFICIENT_VERIFICATION";
    case "AMOUNT_MISMATCH":
      return "STRIPE_AMOUNT_MISMATCH";
    case "DESTINATION_MISMATCH":
      return "STRIPE_DESTINATION_MISMATCH";
    case "DUPLICATE_TRANSFER":
      return "STRIPE_DUPLICATE_TRANSFER";
    default:
      return "PENDING";
  }
}

function classifyDirectToEmployeePayableRow(
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
    stripeChargeId: string | null;
    grossCents: number;
    chargeModel: string;
  },
  index: StripeTransferIndex,
  employeeStripeAccountId: string | null,
  stripeReadable: boolean,
  lookupComplete: boolean,
): BusinessReconciliationRow {
  const remaining = remainingPayableCents(row);
  const base: BusinessReconciliationRow = {
    payableId: row.id,
    transactionId: row.transactionId,
    status: "PENDING",
    routingMode: EmployeeTipPayoutMode.direct_to_employee,
    caretipGrossCents: row.grossCents,
    caretipRemainingCents: remaining,
    caretipStatus: row.status,
    stripeChargeId: row.stripeChargeId,
    stripePaymentIntentId: null,
    stripeTransferId: row.stripeTransferId,
  };

  if (row.status === EmployeeTipPayableStatus.transfer_failed) {
    return { ...base, status: "CARETIP_TRANSFER_FAILED" };
  }
  if (
    row.status === EmployeeTipPayableStatus.held_platform ||
    row.status === EmployeeTipPayableStatus.transferring
  ) {
    return { ...base, status: "CARETIP_EXPECTED_PENDING" };
  }

  if (row.status === EmployeeTipPayableStatus.destination_settled && !stripeReadable) {
    return { ...base, status: "INSUFFICIENT_VERIFICATION" };
  }

  if (!stripeReadable) {
    if (row.status === EmployeeTipPayableStatus.transferred && row.transferredCents > 0) {
      return { ...base, status: "INSUFFICIENT_VERIFICATION" };
    }
    return { ...base, status: "CARETIP_EXPECTED_PENDING" };
  }

  const linked = classifyPayableRow(row, index.byId, index.byPayableMeta, employeeStripeAccountId, {
    stripeBySourceCharge: index.bySourceCharge,
    lookupComplete,
  });
  return { ...base, status: mapDirectTransferStatus(linked.status) };
}

function classifyBusinessPayableRow(
  row: {
    id: string;
    transactionId: string;
    employeeId: string | null;
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
    stripeTransferId: string | null;
    stripeDestinationAccountId: string | null;
    chargeModel: string;
  },
  ctx: {
    businessChargeIds: Set<string>;
    employeeStripeById: Map<string, string>;
    transferIndex: StripeTransferIndex;
    /** Destination accounts whose transfer listing succeeded / hit the page bound. */
    readableDestinations: Set<string>;
    truncatedDestinations: Set<string>;
  },
): BusinessReconciliationRow {
  if (row.routingMode === EmployeeTipPayoutMode.business_distribution) {
    const remaining = remainingPayableCents(row);
    return {
      payableId: row.id,
      transactionId: row.transactionId,
      status: "BUSINESS_DISTRIBUTION",
      routingMode: row.routingMode,
      caretipGrossCents: row.grossCents,
      caretipRemainingCents: remaining,
      caretipStatus: row.status,
      stripeChargeId: row.stripeChargeId,
      stripePaymentIntentId: row.stripePaymentIntentId,
      stripeTransferId: row.stripeTransferId,
    };
  }

  if (row.routingMode === EmployeeTipPayoutMode.direct_to_employee) {
    const employeeStripeAccountId =
      (row.employeeId ? ctx.employeeStripeById.get(row.employeeId) : null) ??
      row.stripeDestinationAccountId;
    const readable = Boolean(employeeStripeAccountId && ctx.readableDestinations.has(employeeStripeAccountId));
    return classifyDirectToEmployeePayableRow(
      row,
      ctx.transferIndex,
      employeeStripeAccountId,
      readable,
      readable && !ctx.truncatedDestinations.has(employeeStripeAccountId as string),
    );
  }

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
    stripeTransferId: row.stripeTransferId,
  };

  if (
    row.chargeModel === EmployeeTipChargeModel.destination_business &&
    row.stripeChargeId &&
    ctx.businessChargeIds.has(row.stripeChargeId)
  ) {
    return { ...base, status: "CHARGE_MATCHED" };
  }

  if (
    row.status === EmployeeTipPayableStatus.held_business ||
    row.status === EmployeeTipPayableStatus.destination_settled
  ) {
    return { ...base, status: row.stripeChargeId ? "CHARGE_PENDING" : "CHARGE_MISMATCH" };
  }

  return base;
}

const ATTENTION_STATUSES = new Set<BusinessReconciliationStatus>([
  "CARETIP_TRANSFER_FAILED",
  "STRIPE_TRANSFER_MISSING",
  "STRIPE_AMOUNT_MISMATCH",
  "STRIPE_DESTINATION_MISMATCH",
  "STRIPE_DUPLICATE_TRANSFER",
  "INSUFFICIENT_VERIFICATION",
  "CHARGE_MISMATCH",
  "CHARGE_PENDING",
  "PENDING",
  "MISMATCH",
]);

export async function reconcileBusinessPayables(
  businessId: string,
): Promise<BusinessReconciliationResult> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { stripeAccountId: true },
  });
  const stripeAccountId = business?.stripeAccountId?.trim() ?? "";

  const payableSelect = {
    id: true,
    transactionId: true,
    employeeId: true,
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
    stripeTransferId: true,
    stripeDestinationAccountId: true,
    createdAt: true,
  } as const;

  const totalPayableCount = await prisma.employeeTipPayable.count({ where: { businessId } });
  const payables: Array<{
    id: string;
    transactionId: string;
    employeeId: string | null;
    routingMode: string;
    chargeModel: string;
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
    stripeTransferId: string | null;
    stripeDestinationAccountId: string | null;
    createdAt: Date;
  }> = [];

  for (let skip = 0; skip < totalPayableCount; skip += RECONCILIATION_PAGE_SIZE) {
    const batch = await prisma.employeeTipPayable.findMany({
      where: { businessId },
      orderBy: { createdAt: "desc" },
      take: RECONCILIATION_PAGE_SIZE,
      skip,
      select: payableSelect,
    });
    payables.push(...batch);
  }

  const payablesTruncated = payables.length < totalPayableCount;
  const employeeIds = [
    ...new Set(
      payables
        .filter((p) => p.routingMode === EmployeeTipPayoutMode.direct_to_employee && p.employeeId)
        .map((p) => p.employeeId as string),
    ),
  ];
  const employeeAccounts = employeeIds.length
    ? await prisma.employeeStripeAccount.findMany({
        where: { employeeId: { in: employeeIds } },
        select: { employeeId: true, stripeAccountId: true },
      })
    : [];
  const employeeStripeById = new Map(
    employeeAccounts
      .map((row) => [row.employeeId, row.stripeAccountId?.trim() ?? ""] as const)
      .filter(([, acct]) => acct.startsWith("acct_")),
  );

  const businessChargeIds = new Set<string>();
  const transferIndex = newStripeTransferIndex();
  const readableDestinations = new Set<string>();
  const truncatedDestinations = new Set<string>();
  let stripeReadable = false;
  let chargesExamined = 0;
  let chargesHasMore = false;
  let transferDestinationsExamined = 0;
  let transfersHasMore = false;

  const stripeConfigured = isStripeConfigured() || listTransfersFnForTests || listChargesFnForTests;

  if (stripeAccountId.startsWith("acct_") && stripeConfigured) {
    try {
      const stripe = getStripeClient();
      const charges = listChargesFnForTests
        ? await listChargesFnForTests({ limit: RECONCILIATION_PAGE_SIZE }, { stripeAccount: stripeAccountId })
        : await stripe.charges.list({ limit: RECONCILIATION_PAGE_SIZE }, { stripeAccount: stripeAccountId });
      chargesExamined = charges.data.length;
      chargesHasMore = charges.has_more;
      stripeReadable = true;
      for (const ch of charges.data) {
        if (ch.id) businessChargeIds.add(ch.id);
      }
    } catch {
      stripeReadable = false;
    }
  }

  const uniqueDestinations = [
    ...new Set(
      payables
        .filter((p) => p.routingMode === EmployeeTipPayoutMode.direct_to_employee)
        .map((p) => {
          if (p.employeeId && employeeStripeById.has(p.employeeId)) {
            return employeeStripeById.get(p.employeeId)!;
          }
          return p.stripeDestinationAccountId?.trim() ?? "";
        })
        .filter((acct) => acct.startsWith("acct_")),
    ),
  ];

  if (stripeConfigured && uniqueDestinations.length > 0) {
    const list: ListTransfersFn =
      listTransfersFnForTests ?? ((params) => getStripeClient().transfers.list(params));
    const createdGte = transferListCreatedGte(
      payables.reduce<Date | null>((min, p) => (!min || p.createdAt < min ? p.createdAt : min), null),
    );
    for (const destination of uniqueDestinations) {
      transferDestinationsExamined += 1;
      try {
        const page = await indexTransfersForDestination(transferIndex, list, destination, createdGte);
        readableDestinations.add(destination);
        stripeReadable = true;
        if (page.hasMore) {
          truncatedDestinations.add(destination);
          transfersHasMore = true;
        }
      } catch {
        // Rows for this destination stay INSUFFICIENT_VERIFICATION rather than "missing".
      }
    }
  }

  const rows = payables.map((row) =>
    classifyBusinessPayableRow(row, {
      businessChargeIds,
      employeeStripeById,
      transferIndex,
      readableDestinations,
      truncatedDestinations,
    }),
  );

  const complete = !payablesTruncated && !chargesHasMore && !transfersHasMore;
  const needsAttention =
    !complete ||
    rows.some((r) => ATTENTION_STATUSES.has(r.status));

  return {
    rows,
    needsAttention,
    stripeReadable,
    complete,
    examinedPayableCount: rows.length,
    totalPayableCount,
    payablesTruncated,
    stripeExamination: {
      chargesExamined,
      chargesHasMore,
      transferDestinationsExamined,
      transfersHasMore,
    },
  };
}
