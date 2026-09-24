/**
 * Canonical business financial metrics from CareTip ledger (not Stripe).
 */
import { EmployeeTipChargeModel, EmployeeTipPayoutMode, EmployeeTipPayableStatus, Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import {
  businessDistributionObservabilityForBusiness,
  type BusinessDistributionObservability,
} from "./businessDistributionIntegrity.service.js";
import { remainingPayableCents } from "./employeeTipPayable.service.js";
import type { BusinessTimeframe } from "../utils/businessTime.js";
import { businessUtcRangeForTimeframe, sanitizeIanaTimezone } from "../utils/businessTime.js";

export type BusinessFinancialMetrics = {
  /** Gross successful customer tip volume (CareTip tips ledger). */
  totalCustomerTipsEur: number;
  tipCount: number;
  /** Employee shares the business must distribute off-platform (business_distribution). */
  employeeDistributionObligationEur: number;
  employeeDistributionObligationRowCount: number;
  /** Gross tips routed direct_to_employee (not business revenue). */
  directToEmployeeGrossTipsEur: number;
  /** Gross tips routed business_distribution. */
  businessDistributionGrossTipsEur: number;
  /** Platform fees on business-attributed payables in scope. */
  caretipFeesEur: number | null;
  feesExact: boolean;
};

function centsToEur(cents: number): number {
  return Math.round(cents) / 100;
}

export async function loadBusinessFinancialMetrics(
  businessId: string,
  opts?: {
    period?: BusinessTimeframe;
    businessTimezone?: string;
    /** Reuse distribution observability when the caller already loaded it. */
    distributionObservability?: BusinessDistributionObservability;
  },
): Promise<BusinessFinancialMetrics> {
  const period = opts?.period ?? "all";
  const tz = sanitizeIanaTimezone(opts?.businessTimezone ?? "Europe/Berlin");
  const range = businessUtcRangeForTimeframe(period, tz);
  const periodStart = range?.startUtc;
  const periodEnd = range?.endUtc;

  const distributionPromise =
    opts?.distributionObservability != null
      ? Promise.resolve(opts.distributionObservability)
      : businessDistributionObservabilityForBusiness(businessId);

  const [tipRows, payables, distribution] = await Promise.all([
    prisma.$queryRaw<Array<{ gross: number; tip_count: number }>>(Prisma.sql`
      SELECT
        COALESCE(SUM(amount), 0)::float AS gross,
        COUNT(*)::int AS tip_count
      FROM tips
      WHERE business_id = ${businessId}
        AND status = 'success'
        ${period !== "all" && periodStart && periodEnd ? Prisma.sql`AND created_at >= ${periodStart} AND created_at <= ${periodEnd}` : Prisma.empty}
    `),
    prisma.employeeTipPayable.findMany({
      where: {
        businessId,
        ...(period !== "all" && periodStart && periodEnd
          ? { createdAt: { gte: periodStart, lte: periodEnd } }
          : {}),
      },
      select: {
        routingMode: true,
        chargeModel: true,
        grossCents: true,
        platformFeeCents: true,
        transactionId: true,
      },
    }),
    distributionPromise,
  ]);

  let directGrossCents = 0;
  let bizDistGrossCents = 0;
  let feeCents = 0;
  let feeRows = 0;
  const payableTxIds = new Set<string>();

  for (const row of payables) {
    if (row.transactionId) payableTxIds.add(row.transactionId);
    feeCents += row.platformFeeCents;
    feeRows += 1;
    if (row.routingMode === EmployeeTipPayoutMode.direct_to_employee) {
      directGrossCents += row.grossCents;
    } else if (row.routingMode === EmployeeTipPayoutMode.business_distribution) {
      bizDistGrossCents += row.grossCents;
    }
  }

  const tipCount = Number(tipRows[0]?.tip_count ?? 0);
  const feesExact = tipCount > 0 && feeRows === tipCount;

  return {
    totalCustomerTipsEur: Number(tipRows[0]?.gross ?? 0),
    tipCount,
    employeeDistributionObligationEur: centsToEur(distribution.heldBusinessCents),
    employeeDistributionObligationRowCount: distribution.heldBusinessRowCount,
    directToEmployeeGrossTipsEur: centsToEur(directGrossCents),
    businessDistributionGrossTipsEur: centsToEur(bizDistGrossCents),
    caretipFeesEur: feesExact ? centsToEur(feeCents) : null,
    feesExact,
  };
}
