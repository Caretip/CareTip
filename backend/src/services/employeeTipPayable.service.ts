/**
 * Per-tip employee payable ledger (integer cents).
 * Never derived from SUM(tips.amount) or Transaction.payoutStatus.
 */
import {
  EmployeeTipChargeModel,
  EmployeeTipPayableStatus,
  EmployeeTipPayoutMode,
  Prisma,
} from "@prisma/client";
import { prisma } from "../prisma.js";
import { calculateTipPlatformFeeCents } from "../config/fees.js";
import { runSerializedByKey } from "../utils/serializedByKey.js";
import type { PaidTipConnectSnapshot } from "./employeeTipRouting.service.js";
import {
  employeePayablePresentationKind,
  type EmployeePayablePresentationKind,
} from "./employeePayableActivityPresentation.js";

export type { EmployeePayablePresentationKind };
export { employeePayablePresentationKind };

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

export async function applyRefundToEmployeePayable(params: {
  transactionId: string;
  refundedCents: number;
}): Promise<void> {
  if (!Number.isInteger(params.refundedCents) || params.refundedCents <= 0) return;

  const head = await prisma.employeeTipPayable.findUnique({
    where: { transactionId: params.transactionId },
    select: { id: true, employeeId: true },
  });
  if (!head) return;

  await runSerializedByKey(payableLockKey(head), async () => {
    const row = await prisma.employeeTipPayable.findUnique({
      where: { id: head.id },
    });
    if (!row) return;

    const refundCap = Math.max(0, row.payableCents - row.disputedLostCents);
    const nextRefunded = Math.min(refundCap, row.refundedCents + params.refundedCents);
    const increment = nextRefunded - row.refundedCents;
    if (increment <= 0) return;

    const { nextReversed, reversalFailed } = await maybeReversePlatformHoldTransfer({
      row,
      incrementCents: increment,
    });

    if (reversalFailed) {
      await prisma.employeeTipPayable.update({
        where: { id: row.id },
        data: {
          lastTransferError: "transfer_reversal_failed",
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

    await prisma.employeeTipPayable.update({
      where: { id: row.id },
      data: {
        refundedCents: nextRefunded,
        reversedCents: nextReversed,
        status,
        lastTransferError: null,
      },
    });
  });
}

export async function applyDisputeToEmployeePayable(params: {
  transactionId: string;
  stripeDisputeId: string;
  disputeAmountCents: number;
  stripeStatus: string;
  stripeEventAccount?: string | null;
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

  await runSerializedByKey(payableLockKey(head), async () => {
    const row = await prisma.employeeTipPayable.findUnique({
      where: { id: head.id },
    });
    if (!row) return;

    const incoming = employeeDisputePhaseFromStripeStatus(params.stripeStatus);
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
        lastTransferError = reversalFailed ? "transfer_reversal_failed" : null;
      }
    }

    await prisma.employeeTipPayable.update({
      where: { id: row.id },
      data: {
        disputedOpenCents: nextOpen,
        disputedLostCents: nextLost,
        stripeDisputeId: disputeId,
        reversedCents: nextReversed,
        lastTransferError,
      },
    });
  });

  return "applied";
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
    if (row.status === EmployeeTipPayableStatus.held_platform) {
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

export type EmployeePayableActivityItem = {
  id: string;
  createdAt: string;
  status: EmployeeTipPayableStatus;
  routingMode: EmployeeTipPayoutMode;
  chargeModel: EmployeeTipChargeModel;
  presentationKind: EmployeePayablePresentationKind;
  payableCents: number;
  transferredCents: number;
  reversedCents: number;
  refundedCents: number;
  remainingPayableCents: number;
  disputedOpenCents: number;
  disputedLostCents: number;
  activityCents: number;
};

export function employeePayableActivityCents(row: EmployeePayableMoneyRow & {
  status: EmployeeTipPayableStatus;
}): number {
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
  params?: { take?: number; skip?: number },
): Promise<{ items: EmployeePayableActivityItem[]; total: number }> {
  const take = Math.min(50, Math.max(1, params?.take ?? 20));
  const skip = Math.min(5_000, Math.max(0, params?.skip ?? 0));
  const where = { employeeId };
  const [total, rows] = await prisma.$transaction([
    prisma.employeeTipPayable.count({ where }),
    prisma.employeeTipPayable.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      skip,
      select: {
        id: true,
        createdAt: true,
        status: true,
        routingMode: true,
        chargeModel: true,
        payableCents: true,
        transferredCents: true,
        reversedCents: true,
        refundedCents: true,
        disputedOpenCents: true,
        disputedLostCents: true,
      },
    }),
  ]);
  return {
    total,
    items: rows.map((row) => {
      const remaining = remainingPayableCents(row);
      return {
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        status: row.status,
        routingMode: row.routingMode,
        chargeModel: row.chargeModel,
        presentationKind: employeePayablePresentationKind(row),
        payableCents: row.payableCents,
        transferredCents: row.transferredCents,
        reversedCents: row.reversedCents,
        refundedCents: row.refundedCents,
        remainingPayableCents: remaining,
        disputedOpenCents: row.disputedOpenCents,
        disputedLostCents: row.disputedLostCents,
        activityCents: employeePayableActivityCents(row),
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
  const rows = await prisma.employeeTipPayable.findMany({
    where: { businessId, status: EmployeeTipPayableStatus.held_platform },
    select: {
      payableCents: true,
      transferredCents: true,
      reversedCents: true,
      refundedCents: true,
      disputedOpenCents: true,
      disputedLostCents: true,
    },
  });
  let heldPlatformCents = 0;
  for (const row of rows) {
    heldPlatformCents += remainingPayableCents(row);
  }
  return { heldPlatformCents, heldRowCount: rows.length };
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
