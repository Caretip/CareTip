import { Prisma, StripeConnectPayoutStatus } from "@prisma/client";
import { prisma } from "../prisma.js";
import { sqlCreatedAtLocal } from "../utils/sqlNaiveUtcToLocal.js";

export type PlatformPayoutAnalytics = {
  summary: {
    businessPayoutCount: number;
    employeePayoutCount: number;
    businessVolumeEur: number;
    employeeVolumeEur: number;
    paidCount: number;
    pendingCount: number;
    failedCount: number;
  };
  volumeByDay: Array<{
    date: string;
    businessPayoutsEur: number;
    employeePayoutsEur: number;
    businessCount: number;
    employeeCount: number;
  }>;
  statusBreakdown: Array<{ status: StripeConnectPayoutStatus; count: number }>;
};

type DailyRow = {
  kind: string;
  d: string;
  c: number;
  eur: number | null;
};

export async function getPlatformPayoutAnalytics(input: {
  startUtc: Date;
  endUtc: Date;
  timezone: string;
}): Promise<PlatformPayoutAnalytics> {
  const { startUtc, endUtc, timezone } = input;

  const [businessAgg, employeeAgg, dailyRows, statusRows] = await Promise.all([
    prisma.stripeConnectPayout.aggregate({
      where: { stripeCreatedAt: { gte: startUtc, lte: endUtc } },
      _count: { _all: true },
      _sum: { amountCents: true },
    }),
    prisma.employeeStripePayout.aggregate({
      where: { stripeCreatedAt: { gte: startUtc, lte: endUtc } },
      _count: { _all: true },
      _sum: { amountCents: true },
    }),
    prisma.$queryRaw<DailyRow[]>(Prisma.sql`
      SELECT 'biz'::text AS kind,
        date_trunc('day', ${sqlCreatedAtLocal(timezone)})::date::text AS d,
        COUNT(*)::int AS c,
        COALESCE(SUM(amount_cents), 0)::float / 100.0 AS eur
      FROM stripe_connect_payouts
      WHERE stripe_created_at >= ${startUtc} AND stripe_created_at <= ${endUtc}
      GROUP BY 2
      UNION ALL
      SELECT 'emp'::text,
        date_trunc('day', ${sqlCreatedAtLocal(timezone)})::date::text,
        COUNT(*)::int,
        COALESCE(SUM(amount_cents), 0)::float / 100.0
      FROM employee_stripe_payouts
      WHERE stripe_created_at >= ${startUtc} AND stripe_created_at <= ${endUtc}
      GROUP BY 2
    `),
    prisma.$queryRaw<Array<{ status: StripeConnectPayoutStatus; c: number }>>(Prisma.sql`
      SELECT status, COUNT(*)::int AS c
      FROM (
        SELECT status FROM stripe_connect_payouts
        WHERE stripe_created_at >= ${startUtc} AND stripe_created_at <= ${endUtc}
        UNION ALL
        SELECT status FROM employee_stripe_payouts
        WHERE stripe_created_at >= ${startUtc} AND stripe_created_at <= ${endUtc}
      ) s
      GROUP BY status
    `),
  ]);

  const paidStatuses = new Set<StripeConnectPayoutStatus>([
    StripeConnectPayoutStatus.paid,
  ]);
  const pendingStatuses = new Set<StripeConnectPayoutStatus>([
    StripeConnectPayoutStatus.pending,
    StripeConnectPayoutStatus.in_transit,
  ]);
  const failedStatuses = new Set<StripeConnectPayoutStatus>([
    StripeConnectPayoutStatus.failed,
    StripeConnectPayoutStatus.canceled,
  ]);

  let paidCount = 0;
  let pendingCount = 0;
  let failedCount = 0;
  for (const row of statusRows) {
    const c = Number(row.c ?? 0);
    if (paidStatuses.has(row.status)) paidCount += c;
    else if (pendingStatuses.has(row.status)) pendingCount += c;
    else if (failedStatuses.has(row.status)) failedCount += c;
  }

  const bizDaily = new Map<string, { eur: number; count: number }>();
  const empDaily = new Map<string, { eur: number; count: number }>();
  for (const r of dailyRows) {
    const d = String(r.d).slice(0, 10);
    const entry = { eur: Number(r.eur ?? 0), count: Number(r.c ?? 0) };
    if (r.kind === "biz") bizDaily.set(d, entry);
    else empDaily.set(d, entry);
  }
  const dayKeys = new Set([...bizDaily.keys(), ...empDaily.keys()]);
  const volumeByDay = [...dayKeys]
    .sort()
    .map((date) => ({
      date,
      businessPayoutsEur: bizDaily.get(date)?.eur ?? 0,
      employeePayoutsEur: empDaily.get(date)?.eur ?? 0,
      businessCount: bizDaily.get(date)?.count ?? 0,
      employeeCount: empDaily.get(date)?.count ?? 0,
    }));

  return {
    summary: {
      businessPayoutCount: businessAgg._count._all,
      employeePayoutCount: employeeAgg._count._all,
      businessVolumeEur: Number(businessAgg._sum.amountCents ?? 0) / 100,
      employeeVolumeEur: Number(employeeAgg._sum.amountCents ?? 0) / 100,
      paidCount,
      pendingCount,
      failedCount,
    },
    volumeByDay,
    statusBreakdown: statusRows.map((r) => ({
      status: r.status,
      count: Number(r.c ?? 0),
    })),
  };
}
