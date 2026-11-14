/**
 * Per-tip employee payable ledger (integer cents).
 * Never derived from SUM(tips.amount) or Transaction.payoutStatus.
 */
import {
  EmployeeTipChargeModel,
  EmployeeTipPayableStatus,
  EmployeeTipPayoutMode,
  Prisma,
  type EmployeeTipPayable,
} from "@prisma/client";
import { prisma } from "../prisma.js";
import { calculateTipPlatformFeeCents } from "../config/fees.js";
import {
  preserveDurableReleaseMarker,
  releaseCreateBlockedByStoredMarker,
} from "../lib/employeeTipReleaseClaim.js";
import { runSerializedByKey } from "../utils/serializedByKey.js";
import type { PaidTipConnectSnapshot } from "./employeeTipRouting.service.js";
import {
  employeePayableDistributionState,
  employeePayablePresentationKind,
  type EmployeePayableDistributionState,
  type EmployeePayablePresentationKind,
} from "./employeePayableActivityPresentation.js";

export type { EmployeePayableDistributionState, EmployeePayablePresentationKind };
export { employeePayableDistributionState, employeePayablePresentationKind };

/** Avoid read/modify/write races that could clear rel_durable on concurrent refund/dispute. */
function mergePayableLastTransferErrorUpdate(
  currentMarker: string | null,
  proposed: string | null,
): { lastTransferError?: string | null } {
  if (releaseCreateBlockedByStoredMarker(currentMarker)) {
    return {};
  }
  return { lastTransferError: preserveDurableReleaseMarker(currentMarker, proposed) };
}

export type EmployeePayableMoneyRow = {
  payableCents: number;
  transferredCents: number;
  reversedCents: number;
  refundedCents: number;
  disputedOpenCents?: number;
  disputedLostCents?: number;
};

export type EmployeeDisputePhase = "open" | "won" | "lost";

function openCents(row: EmployeePayableMoneyRow): number {
  return row.disputedOpenCents ?? 0;
}
function lostCents(row: EmployeePayableMoneyRow): number {
  return row.disputedLostCents ?? 0;
}

/** Platform-hold rows still owed from CareTip (including failed release attempts). */
export function isRecoverablePlatformHoldPayableStatus(status: EmployeeTipPayableStatus): boolean {
  return (
    status === EmployeeTipPayableStatus.held_platform ||
    status === EmployeeTipPayableStatus.transfer_failed
  );
}

/** UI/history timestamp — failure and transfer completion use last ledger update. */
export function employeePayableActivityTimestamp(row: {
  status: EmployeeTipPayableStatus;
  createdAt: Date;
  updatedAt: Date;
}): Date {
  if (
    row.status === EmployeeTipPayableStatus.transfer_failed ||
    row.status === EmployeeTipPayableStatus.transferring ||
    row.status === EmployeeTipPayableStatus.transferred
  ) {
    return row.updatedAt;
  }
  return row.createdAt;
}

/** Remaining amount eligible for a platform-hold Transfer. */
export function remainingPayableCents(row: EmployeePayableMoneyRow): number {
  const remaining =
    row.payableCents -
    row.transferredCents -
    row.reversedCents -
    row.refundedCents -
    openCents(row) -
    lostCents(row);
  return remaining > 0 ? remaining : 0;
}

/** Transferred funds still presented as settled after refunds, reversals, and disputes. */
export function netTransferredCents(row: EmployeePayableMoneyRow): number {
  const remaining =
    row.transferredCents -
    row.reversedCents -
    row.refundedCents -
    openCents(row) -
    lostCents(row);
  return remaining > 0 ? remaining : 0;
}

/** Gate for employee payout-completed notifications — uses payable transfer state, not Transaction.payoutStatus. */
export function employeePayableTransferNotificationEligible(row: {
  routingMode: EmployeeTipPayoutMode;
  status: EmployeeTipPayableStatus;
  payableCents: number;
  transferredCents: number;
  reversedCents: number;
  refundedCents: number;
  disputedOpenCents?: number;
  disputedLostCents?: number;
}): boolean {
  if (row.routingMode === EmployeeTipPayoutMode.business_distribution) return false;
  const transferred =
    row.status === EmployeeTipPayableStatus.transferred ||
    row.status === EmployeeTipPayableStatus.destination_settled;
  return transferred && netTransferredCents(row) > 0;
}

export function employeeDisputePhaseFromStripeStatus(status: string): EmployeeDisputePhase {
  const s = String(status).toLowerCase();
  if (s === "won" || s === "warning_closed") return "won";
  if (s === "lost" || s === "charge_refunded") return "lost";
  return "open";
}

export function employeeDisputeExposureCents(params: {
  payableCents: number;
  refundedCents: number;
  disputeAmountCents: number;
}): number {
  const room = Math.max(0, params.payableCents - params.refundedCents);
  if (!Number.isInteger(params.disputeAmountCents) || params.disputeAmountCents <= 0) return 0;
  return Math.min(room, params.disputeAmountCents);
}

function payableLockKey(row: { id: string; employeeId: string | null }): string {
  return row.employeeId
    ? `employee-tip-release:${row.employeeId}`
    : `employee-tip-payable:${row.id}`;
}

function initialStatus(model: EmployeeTipChargeModel): EmployeeTipPayableStatus {
  switch (model) {
    case EmployeeTipChargeModel.destination_employee:
      return EmployeeTipPayableStatus.destination_settled;
    case EmployeeTipChargeModel.destination_business:
      return EmployeeTipPayableStatus.held_business;
    case EmployeeTipChargeModel.platform_hold:
    default:
      return EmployeeTipPayableStatus.held_platform;
  }
}

export async function createEmployeeTipPayableForSuccessfulTip(params: {
  tx: Prisma.TransactionClient;
  transactionId: string;
  employeeId: string | null;
  businessId: string;
  paymentIntentId: string;
  grossCents: number;
  snapshot: PaidTipConnectSnapshot;
  stripeChargeId: string | null;
  destinationTransferId: string | null;
}): Promise<void> {
  const platformFeeCents = calculateTipPlatformFeeCents(params.grossCents);
  const payableCents = params.grossCents - platformFeeCents;
  if (!Number.isInteger(payableCents) || payableCents <= 0) {
    throw new Error("Invalid employee payable cents");
  }

  const destSettled = params.snapshot.chargeModel === EmployeeTipChargeModel.destination_employee;
  const destBusiness = params.snapshot.chargeModel === EmployeeTipChargeModel.destination_business;
  const status = initialStatus(params.snapshot.chargeModel);
  // Interactive `tx` is Omit<PrismaClient, …>; use the same delegate as the root client.
  const payables = (params.tx as unknown as { employeeTipPayable: typeof prisma.employeeTipPayable })
    .employeeTipPayable;

  const existing = await payables.findUnique({
    where: { transactionId: params.transactionId },
    select: { id: true },
  });
  if (existing) return;

  try {
    await payables.create({
      data: {
        transactionId: params.transactionId,
        employeeId: params.employeeId,
        businessId: params.businessId,
        routingMode: params.snapshot.routingMode,
        chargeModel: params.snapshot.chargeModel,
        status,
        grossCents: params.grossCents,
        platformFeeCents,
        payableCents,
        transferredCents: destSettled ? payableCents : 0,
        stripePaymentIntentId: params.paymentIntentId,
        stripeChargeId: params.stripeChargeId,
        stripeDestinationAccountId: params.snapshot.destinationAccountId,
        // Destination-charge Transfer id (employee or business). transferredCents
        // stays 0 for destination_business — CareTip does not owe an employee SCT.
        stripeTransferId: destSettled || destBusiness ? params.destinationTransferId : null,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return;
    }
    throw err;
  }
}

async function maybeReversePlatformHoldTransfer(params: {
  row: {
    id: string;
    chargeModel: EmployeeTipChargeModel;
    stripeTransferId: string | null;
    transferredCents: number;
    reversedCents: number;
  };
  incrementCents: number;
}): Promise<{ nextReversed: number; reversalFailed: boolean }> {
  let nextReversed = params.row.reversedCents;
  if (
    params.row.chargeModel !== EmployeeTipChargeModel.platform_hold ||
    !params.row.stripeTransferId ||
    params.row.transferredCents <= params.row.reversedCents ||
    params.incrementCents <= 0
  ) {
    return { nextReversed, reversalFailed: false };
  }
  const reverseAmount = Math.min(
    params.incrementCents,
    params.row.transferredCents - params.row.reversedCents,
  );
  if (reverseAmount <= 0) return { nextReversed, reversalFailed: false };
  try {
    const { reverseReleasedEmployeeTransfer } = await import("./employeeTipRelease.service.js");
    await reverseReleasedEmployeeTransfer({
      payableId: params.row.id,
      stripeTransferId: params.row.stripeTransferId,
      amountCents: reverseAmount,
      cumulativeReversedCents: params.row.reversedCents + reverseAmount,
    });
    nextReversed += reverseAmount;
    return { nextReversed, reversalFailed: false };
  } catch (err) {
    const { logServerError } = await import("../utils/httpErrors.js");
    logServerError("employeeTipPayable.transfer_reversal", err, { payableId: params.row.id });
    return { nextReversed, reversalFailed: true };
  }
}

/**
 * Refund/dispute ledger writes hold a row lock for the whole read → Stripe reversal → write, so
 * concurrent events on other instances cannot interleave. The reversal runs inside the
 * transaction: if the write is lost, the retry recomputes the same cumulative reversal and
 * `reverseReleasedEmployeeTransfer` skips what Stripe already reversed.
 */
async function withLockedPayable(
  payableId: string,
  fn: (tx: Prisma.TransactionClient, row: EmployeeTipPayable) => Promise<void>,
): Promise<boolean> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM employee_tip_payables WHERE id = ${payableId} FOR UPDATE`;
      const row = await tx.employeeTipPayable.findUnique({ where: { id: payableId } });
      if (!row) return false;
      await fn(tx, row);
      return true;
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}

/**
 * Returns false when there is no payable (or no positive amount) and nothing ran.
 * `recordRefund` runs under the payable lock and returns whether this call is the first to see the
 * refund succeed, so the TipRefund write and the ledger change commit (or roll back) together.
 */
export async function applyRefundToEmployeePayable(params: {
  transactionId: string;
  refundedCents: number;
  recordRefund?: (tx: Prisma.TransactionClient) => Promise<boolean>;
}): Promise<boolean> {
  if (!Number.isInteger(params.refundedCents) || params.refundedCents <= 0) return false;

  const head = await prisma.employeeTipPayable.findUnique({
    where: { transactionId: params.transactionId },
    select: { id: true, employeeId: true },
  });
  if (!head) return false;

  return runSerializedByKey(payableLockKey(head), () => withLockedPayable(head.id, async (tx, row) => {
    if (params.recordRefund && !(await params.recordRefund(tx))) return;

    const refundCap = Math.max(0, row.payableCents - row.disputedLostCents);
    const nextRefunded = Math.min(refundCap, row.refundedCents + params.refundedCents);
    const increment = nextRefunded - row.refundedCents;
    if (increment <= 0) return;

    const { nextReversed, reversalFailed } = await maybeReversePlatformHoldTransfer({
      row,
      incrementCents: increment,
    });

    if (reversalFailed) {
      await tx.employeeTipPayable.update({
        where: { id: row.id },
        data: {
          ...mergePayableLastTransferErrorUpdate(row.lastTransferError, "transfer_reversal_failed"),
          refundedCents: nextRefunded,
          status:
            nextRefunded >= row.payableCents ? EmployeeTipPayableStatus.refunded : row.status,
        },
      });
      return;
    }

    const status =
      nextRefunded >= row.payableCents
        ? EmployeeTipPayableStatus.refunded
        : row.status === EmployeeTipPayableStatus.refunded
          ? EmployeeTipPayableStatus.refunded
          : row.status;

    await tx.employeeTipPayable.update({
      where: { id: row.id },
      data: {
        refundedCents: nextRefunded,
        reversedCents: nextReversed,
        status,
        ...mergePayableLastTransferErrorUpdate(row.lastTransferError, null),
      },
    });
  }));
}

/** Status a payable returns to when a refund that had fully refunded it is reported failed. */
function statusAfterRefundReversal(row: EmployeeTipPayable): EmployeeTipPayableStatus {
  if (row.chargeModel === EmployeeTipChargeModel.platform_hold) {
    return row.transferredCents - row.reversedCents > 0
      ? EmployeeTipPayableStatus.transferred
      : EmployeeTipPayableStatus.held_platform;
  }
  return initialStatus(row.chargeModel);
}

/**
 * Refund ledger sync (replaces delta application for Stripe refund events).
 *
 * Under the payable row lock: `recordRefund` writes the refund row (returns false when the event was
 * stale and nothing changed), then the payable's `refundedCents` is set to the total of all distinct
 * succeeded refunds for the tip, capped by what is refundable. Replays therefore cannot double-count,
 * and a refund that Stripe later reports as failed lowers the total again.
 *
 * A platform-hold transfer already reversed for a refund that later failed is not re-transferred
 * automatically (that is a new payout decision); it is flagged on the payable and recorded as a
 * payment discrepancy for review.
 *
 * Returns false when there is no payable (the caller records the refund row on its own).
 */
export async function syncEmployeePayableRefundTotal(params: {
  transactionId: string;
  recordRefund: (tx: Prisma.TransactionClient) => Promise<boolean>;
  succeededRefundTotalCents: (tx: Prisma.TransactionClient) => Promise<number>;
}): Promise<boolean> {
  const head = await prisma.employeeTipPayable.findUnique({
    where: { transactionId: params.transactionId },
    select: { id: true, employeeId: true },
  });
  if (!head) return false;

  let reversalStranded: { payableId: string; reversedCents: number; refundedCents: number } | null = null;
  await runSerializedByKey(payableLockKey(head), () => withLockedPayable(head.id, async (tx, row) => {
    if (!(await params.recordRefund(tx))) return;

    const total = await params.succeededRefundTotalCents(tx);
    const refundCap = Math.max(0, row.payableCents - row.disputedLostCents);
    const nextRefunded = Math.max(0, Math.min(refundCap, total));
    if (nextRefunded === row.refundedCents) return;

    if (nextRefunded < row.refundedCents) {
      const status =
        row.status === EmployeeTipPayableStatus.refunded && nextRefunded < row.payableCents
          ? statusAfterRefundReversal(row)
          : row.status;
      const stranded = row.reversedCents > 0;
      await tx.employeeTipPayable.update({
        where: { id: row.id },
        data: {
          refundedCents: nextRefunded,
          status,
          ...(stranded
            ? mergePayableLastTransferErrorUpdate(row.lastTransferError, "refund_failed_after_transfer_reversal")
            : {}),
        },
      });
      if (stranded) {
        reversalStranded = { payableId: row.id, reversedCents: row.reversedCents, refundedCents: nextRefunded };
      }
      return;
    }

    const increment = nextRefunded - row.refundedCents;
    const { nextReversed, reversalFailed } = await maybeReversePlatformHoldTransfer({
      row,
      incrementCents: increment,
    });
    const status =
      nextRefunded >= row.payableCents ? EmployeeTipPayableStatus.refunded : row.status;
    await tx.employeeTipPayable.update({
      where: { id: row.id },
      data: {
        refundedCents: nextRefunded,
        ...(reversalFailed ? {} : { reversedCents: nextReversed }),
        status,
        ...mergePayableLastTransferErrorUpdate(
          row.lastTransferError,
          reversalFailed ? "transfer_reversal_failed" : null,
        ),
      },
    });
  }));

  if (reversalStranded) {
    const { recordPaymentDiscrepancy } = await import("./payments/paymentDiscrepancy.service.js");
    const r = reversalStranded as { payableId: string; reversedCents: number; refundedCents: number };
    await recordPaymentDiscrepancy({
      workflow: "refund",
      kind: "refund_failed_after_transfer_reversal",
      subjectKey: `payable:${r.payableId}`,
      transactionId: params.transactionId,
      details: { reversedCents: r.reversedCents, refundedCentsNow: r.refundedCents },
    });
  }
  return true;
}

export async function applyDisputeToEmployeePayable(params: {
  transactionId: string;
  stripeDisputeId: string;
  disputeAmountCents: number;
  stripeStatus: string;
  stripeEventAccount?: string | null;
  /** Runs under the payable lock; returns the stripe status to apply (after ledger merge). */
  recordDispute?: (tx: Prisma.TransactionClient) => Promise<string>;
}): Promise<"applied" | "skipped_mismatch" | "missing"> {
  const disputeId = params.stripeDisputeId.trim();
  if (!disputeId) return "missing";

  const head = await prisma.employeeTipPayable.findUnique({
    where: { transactionId: params.transactionId },
  });
  if (!head) return "missing";

  const eventAccount = params.stripeEventAccount?.trim() ?? "";
  if (
    eventAccount.startsWith("acct_") &&
    head.stripeDestinationAccountId &&
    head.stripeDestinationAccountId !== eventAccount
  ) {
    return "skipped_mismatch";
  }

  const ran = await runSerializedByKey(payableLockKey(head), () => withLockedPayable(head.id, async (tx, row) => {
    const stripeStatus = params.recordDispute ? await params.recordDispute(tx) : params.stripeStatus;
    const incoming = employeeDisputePhaseFromStripeStatus(stripeStatus);
    const sameDispute = row.stripeDisputeId === disputeId;
    const existingPhase: EmployeeDisputePhase | null = !row.stripeDisputeId
      ? null
      : row.disputedLostCents > 0
        ? "lost"
        : row.disputedOpenCents > 0
          ? "open"
          : "won";

    if (sameDispute && existingPhase && existingPhase !== "open" && incoming === "open") {
      return;
    }

    const exposure = employeeDisputeExposureCents({
      payableCents: row.payableCents,
      refundedCents: row.refundedCents,
      disputeAmountCents: params.disputeAmountCents,
    });

    let nextOpen = 0;
    let nextLost = row.disputedLostCents;
    if (incoming === "open") {
      nextOpen = exposure;
      nextLost = row.disputedLostCents;
    } else if (incoming === "won") {
      nextOpen = 0;
      nextLost = 0;
    } else {
      nextOpen = 0;
      nextLost = exposure;
    }

    let nextReversed = row.reversedCents;
    let lastTransferError = row.lastTransferError;
    if (incoming === "lost" && row.chargeModel === EmployeeTipChargeModel.platform_hold) {
      const targetReversed = Math.min(row.transferredCents, row.refundedCents + nextLost);
      const reverseIncrement = Math.max(0, targetReversed - row.reversedCents);
      if (reverseIncrement > 0) {
        const { nextReversed: reversedAfter, reversalFailed } = await maybeReversePlatformHoldTransfer({
          row,
          incrementCents: reverseIncrement,
        });
        nextReversed = reversedAfter;
        const proposed = reversalFailed ? "transfer_reversal_failed" : null;
        lastTransferError = preserveDurableReleaseMarker(row.lastTransferError, proposed);
      }
    }

    await tx.employeeTipPayable.update({
      where: { id: row.id },
      data: {
        disputedOpenCents: nextOpen,
        disputedLostCents: nextLost,
        stripeDisputeId: disputeId,
        reversedCents: nextReversed,
        ...mergePayableLastTransferErrorUpdate(row.lastTransferError, lastTransferError),
      },
    });
  }));

  return ran ? "applied" : "missing";
}

export async function employeePayableSummaryForEmployee(employeeId: string): Promise<{
  heldPlatformCents: number;
  destinationSettledCents: number;
  transferredCents: number;
  refundedCents: number;
  disputedOpenCents: number;
  disputedLostCents: number;
}> {
  const rows = await prisma.employeeTipPayable.findMany({
    where: { employeeId },
    select: {
      status: true,
      payableCents: true,
      transferredCents: true,
      reversedCents: true,
      refundedCents: true,
      disputedOpenCents: true,
      disputedLostCents: true,
    },
  });

  let heldPlatformCents = 0;
  let destinationSettledCents = 0;
  let transferredCents = 0;
  let refundedCents = 0;
  let disputedOpenCents = 0;
  let disputedLostCents = 0;

  for (const row of rows) {
    refundedCents += row.refundedCents;
    disputedOpenCents += row.disputedOpenCents;
    disputedLostCents += row.disputedLostCents;
    if (isRecoverablePlatformHoldPayableStatus(row.status)) {
      heldPlatformCents += remainingPayableCents(row);
    } else if (row.status === EmployeeTipPayableStatus.destination_settled) {
      destinationSettledCents += netTransferredCents(row);
    } else if (row.status === EmployeeTipPayableStatus.transferred) {
      transferredCents += netTransferredCents(row);
    }
  }

  return {
    heldPlatformCents,
    destinationSettledCents,
    transferredCents,
    refundedCents,
    disputedOpenCents,
    disputedLostCents,
  };
}

export type EmployeePayableActivityFilter =
  | "all"
  | "tips"
  | "transfers"
  | "pending"
  | "distributed"
  | "issues";

export type EmployeePayableActivityItem = {
  id: string;
  createdAt: string;
  updatedAt: string;
  /** Display timestamp for payout history (failure/transfer rows use updatedAt). */
  activityAt: string;
  status: EmployeeTipPayableStatus;
  routingMode: EmployeeTipPayoutMode;
  chargeModel: EmployeeTipChargeModel;
  presentationKind: EmployeePayablePresentationKind;
  grossCents: number;
  platformFeeCents: number;
  payableCents: number;
  transferredCents: number;
  reversedCents: number;
  refundedCents: number;
  remainingPayableCents: number;
  disputedOpenCents: number;
  disputedLostCents: number;
  activityCents: number;
  transactionId: string;
  transactionCreatedAt: string;
  receiptNumber: string | null;
  locationName: string | null;
  tableName: string | null;
  /**
   * Sum of EmployeeTipDistributionAllocation rows the business recorded against this payable
   * (off-platform distribution — never a Stripe transfer or a bank payout).
   */
  distributedCents: number;
  /** Latest EmployeeTipDistributionBatch.completedAt that allocated to this payable. */
  lastDistributedAt: string | null;
  distributionState: EmployeePayableDistributionState;
  businessName: string | null;
};

/** Venue-routed payables — same predicate the business distribution workspace uses. */
const VENUE_DISTRIBUTION_WHERE: Prisma.EmployeeTipPayableWhereInput = {
  routingMode: EmployeeTipPayoutMode.business_distribution,
  chargeModel: EmployeeTipChargeModel.destination_business,
};

function employeePayableActivityFilterWhere(
  filter?: EmployeePayableActivityFilter,
): Prisma.EmployeeTipPayableWhereInput {
  if (!filter || filter === "all") return {};
  if (filter === "transfers") {
    return {
      status: {
        in: [
          EmployeeTipPayableStatus.transferred,
          EmployeeTipPayableStatus.destination_settled,
          EmployeeTipPayableStatus.transferring,
        ],
      },
    };
  }
  if (filter === "pending") {
    return {
      OR: [
        {
          status: {
            in: [EmployeeTipPayableStatus.held_platform, EmployeeTipPayableStatus.transferring],
          },
        },
        // Venue-held shares with no distribution recorded against them yet.
        { status: EmployeeTipPayableStatus.held_business, distributionAllocations: { none: {} } },
      ],
    };
  }
  if (filter === "distributed") {
    return {
      ...VENUE_DISTRIBUTION_WHERE,
      distributionAllocations: { some: {} },
    };
  }
  if (filter === "issues") {
    return {
      OR: [
        {
          status: {
            in: [EmployeeTipPayableStatus.transfer_failed, EmployeeTipPayableStatus.refunded],
          },
        },
        { disputedOpenCents: { gt: 0 } },
      ],
    };
  }
  if (filter === "tips") {
    return {
      status: { not: EmployeeTipPayableStatus.refunded },
    };
  }
  return {};
}

export function employeePayableActivityCents(row: EmployeePayableMoneyRow & {
  status: EmployeeTipPayableStatus;
  /** venue_distributed rows present the recorded distribution amount. */
  presentationKind?: EmployeePayablePresentationKind;
  distributedCents?: number;
}): number {
  if (row.presentationKind === "venue_distributed") {
    return Math.max(0, row.distributedCents ?? 0);
  }
  if (
    row.status === EmployeeTipPayableStatus.destination_settled ||
    row.status === EmployeeTipPayableStatus.transferred
  ) {
    return netTransferredCents(row);
  }
  if (row.status === EmployeeTipPayableStatus.refunded) {
    return row.refundedCents;
  }
  return remainingPayableCents(row);
}

/** Employee-scoped CareTip payable activity. Never Stripe bank payouts. */
export async function listEmployeePayableActivityForEmployee(
  employeeId: string,
  params?: { take?: number; skip?: number; filter?: EmployeePayableActivityFilter },
): Promise<{ items: EmployeePayableActivityItem[]; total: number }> {
  const take = Math.min(50, Math.max(1, params?.take ?? 20));
  const skip = Math.min(5_000, Math.max(0, params?.skip ?? 0));
  const where: Prisma.EmployeeTipPayableWhereInput = {
    employeeId,
    ...employeePayableActivityFilterWhere(params?.filter),
  };
  const [total, rows] = await prisma.$transaction([
    prisma.employeeTipPayable.count({ where }),
    prisma.employeeTipPayable.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      skip,
      select: {
        id: true,
        transactionId: true,
        createdAt: true,
        updatedAt: true,
        status: true,
        routingMode: true,
        chargeModel: true,
        grossCents: true,
        platformFeeCents: true,
        payableCents: true,
        transferredCents: true,
        reversedCents: true,
        refundedCents: true,
        disputedOpenCents: true,
        disputedLostCents: true,
        transaction: {
          select: {
            id: true,
            createdAt: true,
            receiptNumber: true,
            location: { select: { name: true } },
            table: { select: { name: true } },
          },
        },
        business: { select: { name: true } },
        // The same allocation rows the business workspace sums — no second employee ledger.
        distributionAllocations: {
          select: {
            amountCents: true,
            item: { select: { batch: { select: { completedAt: true } } } },
          },
        },
      },
    }),
  ]);
  return {
    total,
    items: rows.map((row) => {
      const remaining = remainingPayableCents(row);
      let distributedCents = 0;
      let lastDistributedAt: Date | null = null;
      for (const allocation of row.distributionAllocations) {
        distributedCents += allocation.amountCents;
        const at = allocation.item.batch.completedAt;
        if (!lastDistributedAt || at > lastDistributedAt) lastDistributedAt = at;
      }
      const presentationKind = employeePayablePresentationKind({ ...row, distributedCents });
      const activityAt =
        presentationKind === "venue_distributed" && lastDistributedAt
          ? lastDistributedAt
          : employeePayableActivityTimestamp(row);
      return {
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        activityAt: activityAt.toISOString(),
        status: row.status,
        routingMode: row.routingMode,
        chargeModel: row.chargeModel,
        presentationKind,
        grossCents: row.grossCents,
        platformFeeCents: row.platformFeeCents,
        payableCents: row.payableCents,
        transferredCents: row.transferredCents,
        reversedCents: row.reversedCents,
        refundedCents: row.refundedCents,
        remainingPayableCents: remaining,
        disputedOpenCents: row.disputedOpenCents,
        disputedLostCents: row.disputedLostCents,
        activityCents: employeePayableActivityCents({ ...row, presentationKind, distributedCents }),
        transactionId: row.transactionId,
        transactionCreatedAt: row.transaction.createdAt.toISOString(),
        receiptNumber: row.transaction.receiptNumber,
        locationName: row.transaction.location?.name ?? null,
        tableName: row.transaction.table?.name ?? null,
        distributedCents,
        lastDistributedAt: lastDistributedAt?.toISOString() ?? null,
        distributionState: employeePayableDistributionState({
          status: row.status,
          chargeModel: row.chargeModel,
          routingMode: row.routingMode,
          obligationCents: remaining,
          distributedCents,
        }),
        businessName: row.business.name ?? null,
      };
    }),
  };
}

/**
 * Read-only observability for the Business Payouts CareTip view.
 * Does not change routing, transfers, or payable amounts.
 */
export async function employeeTipHoldObservabilityForBusiness(businessId: string): Promise<{
  heldPlatformCents: number;
  heldRowCount: number;
}> {
  // Same arithmetic as remainingPayableCents, per row and floored at zero, summed in Postgres.
  const rows = await prisma.$queryRaw<Array<{ held_cents: number; row_count: number }>>(Prisma.sql`
    SELECT
      COALESCE(SUM(GREATEST(
        payable_cents - transferred_cents - reversed_cents - refunded_cents
          - disputed_open_cents - disputed_lost_cents,
        0
      )), 0)::float AS held_cents,
      COUNT(*)::int AS row_count
    FROM employee_tip_payables
    WHERE business_id = ${businessId}
      AND status = 'held_platform'
  `);
  return { heldPlatformCents: Number(rows[0]?.held_cents ?? 0), heldRowCount: Number(rows[0]?.row_count ?? 0) };
}

export function routingModeFromClient(value: unknown): EmployeeTipPayoutMode | null {
  if (value === "direct_to_employee" || value === EmployeeTipPayoutMode.direct_to_employee) {
    return EmployeeTipPayoutMode.direct_to_employee;
  }
  if (value === "business_distribution" || value === EmployeeTipPayoutMode.business_distribution) {
    return EmployeeTipPayoutMode.business_distribution;
  }
  return null;
}
