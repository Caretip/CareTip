/**
 * Canonical employee financial metrics (employee dashboard hero and analytics).
 * - Gross tips: every tip attributed to the employee, independent of the distribution method.
 * - Paid / pending / earnings: CareTip-managed (direct_to_employee) payables only. Business-managed
 *   tips are paid off-platform and cannot be verified, so they are flagged, never counted.
 */
import { EmployeeTipPayableStatus, EmployeeTipPayoutMode, Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import {
  isRecoverablePlatformHoldPayableStatus,
  netTransferredCents,
  remainingPayableCents,
} from "./employeeTipPayable.service.js";
import { remainingDistributableCentsForEmployee } from "./tipDistribution.service.js";

export type EmployeeFinancialMetrics = {
  /**
   * Customer tips before CareTip fees, for every tip attributed to this employee regardless of the
   * business's distribution method: successful tips minus succeeded refunds and lost disputes
   * (Stripe-backed TipRefund rows), clamped per tip so a tip never goes below zero.
   */
  grossTipsEur: number;
  /** True when at least one tip is CareTip-managed (direct_to_employee), so Paid/Pending are verifiable. */
  hasCareTipManagedTips: boolean;
  /** True when at least one tip is business-managed: the business pays it out; CareTip cannot verify that. */
  hasBusinessManagedTips: boolean;
  /**
   * Business-managed tips Stripe settled to the business's account for this employee (after fees,
   * refunds, reversals and disputes) that the business has not yet recorded as distributed.
   */
  businessHeldEur: number;
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
  const [tipRows, payables, businessHeldCents] = await Promise.all([
    // Gross per tip = captured amount minus Stripe-confirmed refunds and lost disputes for that tip.
    // A refund row may arrive before its tip row exists (tip_id NULL), so it is matched by
    // PaymentIntent as well. stripe_refund_id / stripe_dispute_id are unique, so duplicate
    // webhook deliveries cannot add a second deduction. Open or won disputes do not reduce gross.
    prisma.$queryRaw<Array<{ gross: number; tip_count: number }>>(Prisma.sql`
      WITH employee_tips AS (
        SELECT t.id, t.amount, t.stripe_payment_intent_id
        FROM tips t
        WHERE t.employee_id = ${employeeId}
          AND t.status = 'success'
      ),
      deductions AS (
        SELECT et.id AS tip_id, COALESCE(SUM(r.amount_eur), 0) AS deducted
        FROM employee_tips et
        JOIN tip_refunds r
          ON (r.tip_id = et.id
              OR (r.tip_id IS NULL
                  AND et.stripe_payment_intent_id IS NOT NULL
                  AND r.stripe_payment_intent_id = et.stripe_payment_intent_id))
         AND lower(r.currency) = 'eur'
         AND (
           (r.kind = 'refund' AND r.status = 'succeeded')
           OR (r.kind IN ('dispute', 'chargeback') AND r.status = 'lost')
         )
        GROUP BY et.id
      )
      SELECT
        COALESCE(SUM(GREATEST(0, et.amount - LEAST(et.amount, COALESCE(d.deducted, 0)))), 0)::float AS gross,
        COUNT(*)::int AS tip_count
      FROM employee_tips et
      LEFT JOIN deductions d ON d.tip_id = et.id
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
    remainingDistributableCentsForEmployee(employeeId),
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
  let hasCareTipManagedTips = false;
  let hasBusinessManagedTips = false;

  for (const row of payables) {
    // routingMode is fixed per tip when it is paid, so a later change of the business's
    // distribution method never moves historical tips between these buckets.
    if (row.routingMode === EmployeeTipPayoutMode.business_distribution) {
      // Paid out by the business outside CareTip/Stripe: not verifiable here, so never counted
      // as paid or pending. Business-reported distributions stay in the detail views.
      hasBusinessManagedTips = true;
      continue;
    }
    hasCareTipManagedTips = true;

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
    hasCareTipManagedTips,
    hasBusinessManagedTips,
    businessHeldEur: centsToEur(businessHeldCents),
    employeeEarningsEur: centsToEur(employeeEarningsCents),
    paidToStripeEur: centsToEur(paidToStripeCents),
    pendingReleaseEur: centsToEur(pendingReleaseCents),
    totalSupporters,
    prePayableGrossTipsEur: centsToEur(prePayableGrossCents),
  };
}
