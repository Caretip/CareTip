/**
 * Employee Analytics bundle — CareTip ledger + read-only Stripe summary.
 */
import { EmployeeTipPayoutMode, Prisma, TipStatus } from "@prisma/client";
import type Stripe from "stripe";
import { prisma } from "../prisma.js";
import { businessUtcRangeForTimeframe, sanitizeIanaTimezone } from "../utils/businessTime.js";
import { loadEmployeeFinancialMetrics } from "./employeeFinancialMetrics.service.js";
import { reconcileEmployeeDirectPayables } from "./employeePayoutReconciliation.service.js";
import { listEmployeeStripeBankPayoutsForUser } from "./employeeStripeBankPayouts.service.js";
import { getEmployeeInstantPayoutEligibilityForStripeAccount } from "./employeeInstantPayout.service.js";
import { getStripeClient, isStripeConfigured } from "./stripe.service.js";
import { resolveActiveEmployeeForConnect } from "./employeeStripeConnect.service.js";

export type EmployeeAnalyticsPeriod = "today" | "week" | "month" | "year" | "all";

export type EmployeeAnalyticsTipRecord = {
  id: string;
  createdAt: string;
  receiptNumber: string | null;
  grossEur: number;
  platformFeeEur: number | null;
  employeeEarningsEur: number | null;
  routingMode: string | null;
  chargeModel: string | null;
  payoutStatus: string;
  payoutStatusLabel: string;
  hasPayable: boolean;
};

export type EmployeeAnalyticsStripeTransfer = {
  id: string;
  createdAt: string;
  amountCents: number;
  currency: string;
  destination: string | null;
  caretipPayableId: string | null;
  reversed: boolean;
};

export type EmployeeAnalyticsBundle = {
  period: EmployeeAnalyticsPeriod;
  periodStart: string;
  periodEnd: string;
  periodBasis: string;
  metrics: {
    grossTipsEur: number;
    employeeEarningsEur: number;
    paidToStripeEur: number;
    pendingReleaseEur: number;
    totalSupporters: number;
    prePayableGrossTipsEur: number;
    caretipFeesFromPayablesEur: number | null;
    feesExact: boolean;
    tipCount: number;
    averageTipEur: number;
    largestTipEur: number;
  };
  lifetimeMetrics: Awaited<ReturnType<typeof loadEmployeeFinancialMetrics>>;
  tipRecords: EmployeeAnalyticsTipRecord[];
  chartSeries: Array<{ label: string; grossEur: number; earningsEur: number }>;
  reconciliation: Awaited<ReturnType<typeof reconcileEmployeeDirectPayables>>;
  stripe: {
    readable: boolean;
    availableCents: number | null;
    pendingCents: number | null;
    instantAvailableCents: number | null;
    currency: string | null;
    transfers: EmployeeAnalyticsStripeTransfer[];
    bankPayouts: Awaited<ReturnType<typeof listEmployeeStripeBankPayoutsForUser>>;
  };
};

function payoutStatusLabel(
  routingMode: string | null,
  status: string | null,
  hasPayable: boolean,
): string {
  if (routingMode === "business_distribution") return "paid_to_business";
  if (!hasPayable) return "legacy_no_payable";
  if (status === "transferred" || status === "destination_settled") return "transferred";
  if (status === "transfer_failed") return "release_failed";
  if (status === "held_platform" || status === "transferring") return "pending_release";
  return status ?? "unknown";
}

function periodToTimeframe(period: EmployeeAnalyticsPeriod): "today" | "week" | "month" | "year" | "all" {
  return period;
}

export async function loadEmployeeAnalyticsForUser(
  userId: string,
  opts: { period?: EmployeeAnalyticsPeriod; businessTimezone?: string },
): Promise<EmployeeAnalyticsBundle> {
  const actor = await resolveActiveEmployeeForConnect(userId);
  const period = opts.period ?? "month";
  const tz = sanitizeIanaTimezone(opts.businessTimezone ?? "Europe/Berlin");
  const range = businessUtcRangeForTimeframe(periodToTimeframe(period), tz);
  const periodStart = range?.startUtc ?? new Date(0);
  const periodEnd = range?.endUtc ?? new Date();

  const [lifetimeMetrics, tips, reconciliation] = await Promise.all([
    loadEmployeeFinancialMetrics(actor.employeeId),
    prisma.transaction.findMany({
      where: {
        employeeId: actor.employeeId,
        status: TipStatus.success,
        createdAt: period === "all" ? undefined : { gte: periodStart, lte: periodEnd },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        amount: true,
        createdAt: true,
        receiptNumber: true,
        employeeTipPayable: {
          select: {
            grossCents: true,
            platformFeeCents: true,
            payableCents: true,
            routingMode: true,
            chargeModel: true,
            status: true,
          },
        },
      },
    }),
    reconcileEmployeeDirectPayables(actor.employeeId),
  ]);

  let grossPeriodCents = 0;
  let earningsPeriodCents = 0;
  let feePeriodCents = 0;
  let feeRows = 0;
  let tipCount = 0;
  let largestCents = 0;

  const tipRecords: EmployeeAnalyticsTipRecord[] = tips.map((tip) => {
    const payable = tip.employeeTipPayable;
    const grossCents = Math.round(Number(tip.amount) * 100);
    grossPeriodCents += grossCents;
    tipCount += 1;
    if (grossCents > largestCents) largestCents = grossCents;
    if (payable && payable.routingMode === EmployeeTipPayoutMode.direct_to_employee) {
      earningsPeriodCents += payable.payableCents;
      feePeriodCents += payable.platformFeeCents;
      feeRows += 1;
    }
    return {
      id: tip.id,
      createdAt: tip.createdAt.toISOString(),
      receiptNumber: tip.receiptNumber,
      grossEur: grossCents / 100,
      platformFeeEur: payable ? payable.platformFeeCents / 100 : null,
      employeeEarningsEur: payable ? payable.payableCents / 100 : null,
      routingMode: payable?.routingMode ?? null,
      chargeModel: payable?.chargeModel ?? null,
      payoutStatus: payable?.status ?? "no_payable",
      payoutStatusLabel: payoutStatusLabel(
        payable?.routingMode ?? null,
        payable?.status ?? null,
        Boolean(payable),
      ),
      hasPayable: Boolean(payable),
    };
  });

  const periodGrossEur = grossPeriodCents / 100;
  const periodEarningsEur = earningsPeriodCents / 100;
  const feesExact = tipCount > 0 && feeRows === tipCount;

  const chartRows = await prisma.$queryRaw<
    Array<{ day: string; gross: number; earnings: number }>
  >(Prisma.sql`
    SELECT
      to_char(t.created_at AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day,
      COALESCE(SUM(t.amount), 0)::float AS gross,
      COALESCE(SUM(p.payable_cents) / 100.0, 0)::float AS earnings
    FROM tips t
    LEFT JOIN employee_tip_payables p ON p.transaction_id = t.id
    WHERE t.employee_id = ${actor.employeeId}
      AND t.status = 'success'
      AND t.created_at >= ${periodStart}
      AND t.created_at <= ${periodEnd}
    GROUP BY 1
    ORDER BY 1 ASC
  `);

  const chartSeries = chartRows.map((r) => ({
    label: r.day,
    grossEur: Number(r.gross ?? 0),
    earningsEur: Number(r.earnings ?? 0),
  }));

  const account = await prisma.employeeStripeAccount.findUnique({
    where: { employeeId: actor.employeeId },
    select: { stripeAccountId: true, stripePayoutsEnabled: true },
  });
  const stripeAccountId = account?.stripeAccountId?.trim() ?? "";
  let stripeReadable = false;
  let availableCents: number | null = null;
  let pendingCents: number | null = null;
  let instantAvailableCents: number | null = null;
  let currency: string | null = null;
  const transfers: EmployeeAnalyticsStripeTransfer[] = [];

  const stripeWork =
    stripeAccountId.startsWith("acct_") && isStripeConfigured() && account
      ? (async () => {
          try {
            const stripe = getStripeClient();
            const [trList, instant] = await Promise.all([
              stripe.transfers.list({ destination: stripeAccountId, limit: 25 }),
              getEmployeeInstantPayoutEligibilityForStripeAccount(actor.employeeId, account).catch(
                () => null,
              ),
            ]);
            for (const tr of trList.data) {
              transfers.push({
                id: tr.id,
                createdAt: new Date(tr.created * 1000).toISOString(),
                amountCents: tr.amount,
                currency: tr.currency,
                destination: typeof tr.destination === "string" ? tr.destination : null,
                caretipPayableId: tr.metadata?.caretip_payable_id ?? null,
                reversed: tr.reversed,
              });
            }
            if (instant?.balancesRetrieved) {
              stripeReadable = true;
              availableCents = instant.availableCents;
              pendingCents = instant.pendingCents;
              currency = instant.currency;
              instantAvailableCents = instant.instantAvailableGrossCents;
            }
          } catch {
            stripeReadable = false;
          }
        })()
      : Promise.resolve();

  const [bankPayouts] = await Promise.all([
    listEmployeeStripeBankPayoutsForUser(userId, { take: 25 }),
    stripeWork,
  ]);

  return {
    period,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    periodBasis: "tip_created_at",
    metrics: {
      grossTipsEur: period === "all" ? lifetimeMetrics.grossTipsEur : periodGrossEur,
      employeeEarningsEur: period === "all" ? lifetimeMetrics.employeeEarningsEur : periodEarningsEur,
      paidToStripeEur: lifetimeMetrics.paidToStripeEur,
      pendingReleaseEur: lifetimeMetrics.pendingReleaseEur,
      totalSupporters: period === "all" ? lifetimeMetrics.totalSupporters : tipCount,
      prePayableGrossTipsEur: lifetimeMetrics.prePayableGrossTipsEur,
      caretipFeesFromPayablesEur: feesExact ? feePeriodCents / 100 : null,
      feesExact,
      tipCount,
      averageTipEur: tipCount > 0 ? periodGrossEur / tipCount : 0,
      largestTipEur: largestCents / 100,
    },
    lifetimeMetrics,
    tipRecords,
    chartSeries,
    reconciliation,
    stripe: {
      readable: stripeReadable,
      availableCents,
      pendingCents,
      instantAvailableCents,
      currency,
      transfers,
      bankPayouts,
    },
  };
}
