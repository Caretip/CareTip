/**
 * Canonical business financial metrics from CareTip ledger (not Stripe).
 */
import { sqlUtcTimestamp } from "../utils/sqlUtcTimestamp.js";
import { EmployeeTipPayoutMode, Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import {
  businessDistributionRemainingObligationForBusiness,
  type BusinessDistributionObligationSnapshot,
} from "./tipDistribution.service.js";
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
    /** Reuse allocation-aware obligation when the caller already loaded it. */
    distributionObligation?: BusinessDistributionObligationSnapshot;
  },
): Promise<BusinessFinancialMetrics> {
  const period = opts?.period ?? "all";
  const tz = sanitizeIanaTimezone(opts?.businessTimezone ?? "Europe/Berlin");
  const range = businessUtcRangeForTimeframe(period, tz);
  const periodStart = range?.startUtc;
  const periodEnd = range?.endUtc;

  const obligationPromise =
    opts?.distributionObligation != null
      ? Promise.resolve(opts.distributionObligation)
      : businessDistributionRemainingObligationForBusiness(businessId);

  // Summed in Postgres: this runs on every dashboard load, and a business accumulates one payable
  // per tip forever, so reading the rows into Node blocked the event loop for every other request.
  const [tipRows, payableGroups, obligation] = await Promise.all([
    prisma.$queryRaw<Array<{ gross: number; tip_count: number }>>(Prisma.sql`
      SELECT
        COALESCE(SUM(amount), 0)::float AS gross,
        COUNT(*)::int AS tip_count
      FROM tips
      WHERE business_id = ${businessId}
        AND status = 'success'
        ${period !== "all" && periodStart && periodEnd ? Prisma.sql`AND created_at >= ${sqlUtcTimestamp(periodStart)} AND created_at <= ${sqlUtcTimestamp(periodEnd)}` : Prisma.empty}
    `),
    prisma.$queryRaw<
      Array<{ routing_mode: EmployeeTipPayoutMode; gross_cents: number; fee_cents: number; row_count: number }>
    >(Prisma.sql`
      SELECT
        p.routing_mode::text AS routing_mode,
        COALESCE(SUM(p.gross_cents), 0)::float AS gross_cents,
        COALESCE(SUM(p.platform_fee_cents), 0)::float AS fee_cents,
        COUNT(*)::int AS row_count
      FROM employee_tip_payables p
      ${period !== "all" && periodStart && periodEnd ? Prisma.sql`JOIN tips t ON t.id = p.transaction_id` : Prisma.empty}
      WHERE p.business_id = ${businessId}
        ${period !== "all" && periodStart && periodEnd ? Prisma.sql`AND t.created_at >= ${sqlUtcTimestamp(periodStart)} AND t.created_at <= ${sqlUtcTimestamp(periodEnd)}` : Prisma.empty}
      GROUP BY p.routing_mode
    `),
    obligationPromise,
  ]);

  let directGrossCents = 0;
  let bizDistGrossCents = 0;
  let feeCents = 0;
  let feeRows = 0;

  for (const group of payableGroups) {
    feeCents += group.fee_cents;
    feeRows += group.row_count;
    if (group.routing_mode === EmployeeTipPayoutMode.direct_to_employee) {
      directGrossCents += group.gross_cents;
    } else if (group.routing_mode === EmployeeTipPayoutMode.business_distribution) {
      bizDistGrossCents += group.gross_cents;
    }
  }

  const tipCount = Number(tipRows[0]?.tip_count ?? 0);
  /**
   * Exact when every successful tip in scope has a payable with frozen platformFeeCents.
   * transaction_id is unique on payables, so the row count is also the distinct transaction count.
   */
  const feesExact = tipCount > 0 && feeRows === tipCount;

  return {
    totalCustomerTipsEur: Number(tipRows[0]?.gross ?? 0),
    tipCount,
    employeeDistributionObligationEur: centsToEur(obligation.remainingDistributableCents),
    employeeDistributionObligationRowCount: obligation.payableRowCount,
    directToEmployeeGrossTipsEur: centsToEur(directGrossCents),
    businessDistributionGrossTipsEur: centsToEur(bizDistGrossCents),
    caretipFeesEur: feesExact ? centsToEur(feeCents) : null,
    feesExact,
  };
}
