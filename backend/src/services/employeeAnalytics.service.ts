/**
 * Employee Analytics bundle — CareTip ledger + read-only Stripe summary.
 */
import { EmployeeTipPayoutMode, Prisma, TipStatus } from "@prisma/client";
import type Stripe from "stripe";
import { prisma } from "../prisma.js";
import { businessUtcRangeForTimeframe, sanitizeIanaTimezone } from "../utils/businessTime.js";
import { sqlNaiveUtcColumnAsLocal } from "../utils/sqlNaiveUtcToLocal.js";
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
  /** IANA timezone used for period boundaries and chart buckets (from Business.timezone). */
  businessTimezone: string;
  metrics: {
    /** Period-scoped metrics only — see lifetimeMetrics for lifetime balances. */
    scope: "period";
    grossTipsEur: number;
    employeeEarningsEur: number;
    totalSupporters: number;
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

type EmployeeAnalyticsPeriodKpiRow = {
  tip_count: number;
  gross_eur: number;
  largest_eur: number;
  fee_cents: number;
  payable_count: number;
  earnings_cents: number;
};

const EMPTY_PERIOD_KPIS: EmployeeAnalyticsPeriodKpiRow = {
  tip_count: 0,
  gross_eur: 0,
  largest_eur: 0,
  fee_cents: 0,
  payable_count: 0,
  earnings_cents: 0,
};

/** Full-period KPI aggregate — never limited to recent tip rows. */
async function queryEmployeeAnalyticsPeriodKpis(opts: {
  employeeId: string;
  periodStart: Date;
  periodEnd: Date;
}): Promise<EmployeeAnalyticsPeriodKpiRow> {
  const [row] = await prisma.$queryRaw<EmployeeAnalyticsPeriodKpiRow[]>(Prisma.sql`
    SELECT
      COUNT(*)::int AS tip_count,
      COALESCE(SUM(t.amount), 0)::float AS gross_eur,
      COALESCE(MAX(t.amount), 0)::float AS largest_eur,
      COALESCE(SUM(p.platform_fee_cents), 0)::int AS fee_cents,
      COUNT(p.id)::int AS payable_count,
      COALESCE(SUM(
        CASE
          WHEN p.routing_mode::text = 'direct_to_employee'
            THEN GREATEST(0, p.payable_cents - p.refunded_cents)
          ELSE 0
        END
      ), 0)::int AS earnings_cents
    FROM tips t
    LEFT JOIN employee_tip_payables p ON p.transaction_id = t.id
    WHERE t.employee_id = ${opts.employeeId}
      AND t.status = 'success'
      AND t.created_at >= ${opts.periodStart}
      AND t.created_at <= ${opts.periodEnd}
  `);
  return row ?? EMPTY_PERIOD_KPIS;
}

/** Direct employee entitlement for analytics — matches lifetime metrics semantics. */
function directEmployeeEarningsEur(
  payable: {
    payableCents: number;
    refundedCents: number;
    routingMode: EmployeeTipPayoutMode;
  } | null,
): number | null {
  if (!payable) return null;
  if (payable.routingMode === EmployeeTipPayoutMode.business_distribution) return null;
  return Math.max(0, payable.payableCents - payable.refundedCents) / 100;
}

function mapTipToAnalyticsRecord(tip: {
  id: string;
  amount: unknown;
  createdAt: Date;
  receiptNumber: string | null;
  employeeTipPayable: {
    grossCents: number;
    platformFeeCents: number;
    payableCents: number;
    refundedCents: number;
    routingMode: EmployeeTipPayoutMode;
    chargeModel: string;
    status: string;
  } | null;
}): EmployeeAnalyticsTipRecord {
  const payable = tip.employeeTipPayable;
  const grossCents = Math.round(Number(tip.amount) * 100);
  return {
    id: tip.id,
    createdAt: tip.createdAt.toISOString(),
    receiptNumber: tip.receiptNumber,
    grossEur: grossCents / 100,
    platformFeeEur: payable ? payable.platformFeeCents / 100 : null,
    employeeEarningsEur: directEmployeeEarningsEur(payable),
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
}

export async function loadEmployeeAnalyticsForUser(
  userId: string,
  opts: { period?: EmployeeAnalyticsPeriod; businessTimezone?: string },
): Promise<EmployeeAnalyticsBundle> {
  const actor = await resolveActiveEmployeeForConnect(userId);
  const period = opts.period ?? "month";
  const businessRow = await prisma.business.findUnique({
    where: { id: actor.businessId },
    select: { timezone: true },
  });
  const tz = sanitizeIanaTimezone(opts.businessTimezone ?? businessRow?.timezone);
  const range = businessUtcRangeForTimeframe(periodToTimeframe(period), tz);
  const periodStart = range?.startUtc ?? new Date(0);
  const periodEnd = range?.endUtc ?? new Date();

  const [lifetimeMetrics, periodKpis, recentTips, reconciliation] = await Promise.all([
    loadEmployeeFinancialMetrics(actor.employeeId),
    period === "all"
      ? Promise.resolve(null)
      : queryEmployeeAnalyticsPeriodKpis({
          employeeId: actor.employeeId,
          periodStart,
          periodEnd,
        }),
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
            refundedCents: true,
            routingMode: true,
            chargeModel: true,
            status: true,
          },
        },
      },
    }),
    reconcileEmployeeDirectPayables(actor.employeeId),
  ]);

  const tipRecords: EmployeeAnalyticsTipRecord[] = recentTips.map(mapTipToAnalyticsRecord);

  const tipCount = periodKpis?.tip_count ?? 0;
  const periodGrossEur = periodKpis?.gross_eur ?? 0;
  const periodEarningsEur = (periodKpis?.earnings_cents ?? 0) / 100;
  const feesExact = tipCount > 0 && (periodKpis?.payable_count ?? 0) === tipCount;
  const feePeriodCents = periodKpis?.fee_cents ?? 0;
  const largestTipEur = periodKpis?.largest_eur ?? 0;

  const chartRows = await prisma.$queryRaw<
    Array<{ day: string; gross: number; earnings: number }>
  >(Prisma.sql`
    SELECT
      to_char(date_trunc('day', ${sqlNaiveUtcColumnAsLocal(Prisma.sql`t.created_at`, tz)}), 'YYYY-MM-DD') AS day,
      COALESCE(SUM(t.amount), 0)::float AS gross,
      COALESCE(SUM(
        CASE
          WHEN p.routing_mode::text = 'direct_to_employee'
            THEN GREATEST(0, p.payable_cents - p.refunded_cents) / 100.0
          ELSE 0
        END
      ), 0)::float AS earnings
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
    businessTimezone: tz,
    metrics: {
      scope: "period",
      grossTipsEur: period === "all" ? lifetimeMetrics.grossTipsEur : periodGrossEur,
      employeeEarningsEur: period === "all" ? lifetimeMetrics.employeeEarningsEur : periodEarningsEur,
      totalSupporters: period === "all" ? lifetimeMetrics.totalSupporters : tipCount,
      caretipFeesFromPayablesEur: feesExact ? feePeriodCents / 100 : null,
      feesExact,
      tipCount,
      averageTipEur: tipCount > 0 ? periodGrossEur / tipCount : 0,
      largestTipEur,
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
