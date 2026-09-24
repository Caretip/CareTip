/**
 * Canonical employee financial metrics — direct-to-employee payout mode only.
 * Business-distribution obligations are excluded (business pays off-platform).
 */
import { EmployeeTipPayableStatus, EmployeeTipPayoutMode, Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import {
  isRecoverablePlatformHoldPayableStatus,
  netTransferredCents,
  remainingPayableCents,
} from "./employeeTipPayable.service.js";

export type EmployeeFinancialMetrics = {
  /** Sum of successful customer tip amounts (gross, before CareTip fees). */
  grossTipsEur: number;
  /** Net employee entitlement from EmployeeTipPayable ledger (direct_to_employee only). */
  employeeEarningsEur: number;
  /** Successfully routed to employee Stripe Connect (transferred + destination_settled). */
  paidToStripeEur: number;
  /** Owed but not yet on employee Connect (held_platform, transfer_failed, transferring). */
  pendingReleaseEur: number;
  totalSupporters: number;
  /** Gross tips with no payable row (pre-ledger era) — gross only, not in employeeEarnings. */
  prePayableGrossTipsEur: number;
};

function centsToEur(cents: number): number {
  return Math.round(cents) / 100;
}

export async function loadEmployeeFinancialMetrics(
  employeeId: string,
): Promise<EmployeeFinancialMetrics> {
  const [tipRows, payables] = await Promise.all([
    prisma.$queryRaw<Array<{ gross: number; tip_count: number }>>(Prisma.sql`
      SELECT
        COALESCE(SUM(amount), 0)::float AS gross,
        COUNT(*)::int AS tip_count
      FROM tips
      WHERE employee_id = ${employeeId}
        AND status = 'success'
    `),
    prisma.employeeTipPayable.findMany({
      where: { employeeId },
      select: {
        routingMode: true,
        status: true,
        payableCents: true,
        transferredCents: true,
        reversedCents: true,
        refundedCents: true,
        disputedOpenCents: true,
        disputedLostCents: true,
        transactionId: true,
      },
    }),
  ]);

  const grossTipsEur = Number(tipRows[0]?.gross ?? 0);
  const totalSupporters = Number(tipRows[0]?.tip_count ?? 0);

  const payableTransactionIds = new Set(
    payables.map((p) => p.transactionId).filter((id): id is string => Boolean(id)),
  );

  let prePayableGrossCents = 0;
  if (totalSupporters > payableTransactionIds.size) {
    const orphanTips = await prisma.transaction.findMany({
      where: {
        employeeId,
        status: "success",
        id: { notIn: [...payableTransactionIds] },
      },
      select: { amount: true },
    });
    for (const tip of orphanTips) {
      prePayableGrossCents += Math.round(Number(tip.amount) * 100);
    }
  }

  let employeeEarningsCents = 0;
  let paidToStripeCents = 0;
  let pendingReleaseCents = 0;

  for (const row of payables) {
    if (row.routingMode === EmployeeTipPayoutMode.business_distribution) {
      continue;
    }

    const entitlement = Math.max(0, row.payableCents - row.refundedCents);
    employeeEarningsCents += entitlement;

    if (
      isRecoverablePlatformHoldPayableStatus(row.status) ||
      row.status === EmployeeTipPayableStatus.transferring
    ) {
      pendingReleaseCents += remainingPayableCents(row);
    } else if (
      row.status === EmployeeTipPayableStatus.destination_settled ||
      row.status === EmployeeTipPayableStatus.transferred
    ) {
      paidToStripeCents += netTransferredCents(row);
    }
  }

  return {
    grossTipsEur,
    employeeEarningsEur: centsToEur(employeeEarningsCents),
    paidToStripeEur: centsToEur(paidToStripeCents),
    pendingReleaseEur: centsToEur(pendingReleaseCents),
    totalSupporters,
    prePayableGrossTipsEur: centsToEur(prePayableGrossCents),
  };
}
