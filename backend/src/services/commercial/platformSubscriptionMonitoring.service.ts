import { Prisma, SubscriptionStatus } from "@prisma/client";
import { prisma } from "../../prisma.js";
import { STRIPE_BILLING_AUDIT_TYPES } from "../../lib/subscription/subscriptionAuditTypes.js";
import { getSubscriptionIntelligence } from "./subscriptionIntelligence.service.js";
import { sanitizeLikeContainsSearch } from "../../utils/likeSearch.js";

export type PlatformSubscriptionActivityFilter =
  | "all"
  | "successful"
  | "failed"
  | "trialing"
  | "active"
  | "cancelled"
  | "past_due";

export type PlatformSubscriptionPaymentStatus = "succeeded" | "failed" | "pending" | "none";

export type PlatformSubscriptionOverview = {
  active: number;
  trialing: number;
  successful: number;
  failed: number;
  cancelled: number;
  expired: number;
};

export type PlatformSubscriptionWidgets = {
  successRatePercent: number;
  failedPaymentsToday: number;
  failedPaymentsThisWeek: number;
  trialsEndingSoon: number;
  renewalsDueToday: number;
};

export type PlatformSubscriptionActivityRow = {
  businessId: string;
  businessName: string;
  contactEmail: string | null;
  planKey: string;
  billingCycle: string;
  status: SubscriptionStatus;
  paymentStatus: PlatformSubscriptionPaymentStatus;
  amountCents: number | null;
  billingPeriodEnd: string | null;
  activityAt: string;
  lastPaymentAttemptAt: string | null;
};

type LastPaymentEvent = {
  subscriptionId: string;
  auditType: string;
  occurredAt: Date;
  amountCents: number | null;
};

function startOfUtcDay(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function endOfUtcDay(d = new Date()): Date {
  const start = startOfUtcDay(d);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000);
}

function amountFromPayload(auditType: string, payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as { amountPaid?: number };
  if (auditType === STRIPE_BILLING_AUDIT_TYPES.invoicePaymentSucceeded && typeof p.amountPaid === "number") {
    return p.amountPaid;
  }
  return null;
}

async function loadLastPaymentEvents(): Promise<Map<string, LastPaymentEvent>> {
  const rows = await prisma.$queryRaw<
    Array<{
      subscription_id: string;
      audit_type: string;
      occurred_at: Date;
      payload: unknown;
    }>
  >`
    SELECT DISTINCT ON (subscription_id)
      subscription_id,
      audit_type,
      occurred_at,
      payload
    FROM subscription_events
    WHERE subscription_id IS NOT NULL
      AND audit_type IN ('invoice_payment_succeeded', 'payment_failed')
    ORDER BY subscription_id, occurred_at DESC
  `;

  const map = new Map<string, LastPaymentEvent>();
  for (const row of rows) {
    map.set(row.subscription_id, {
      subscriptionId: row.subscription_id,
      auditType: row.audit_type,
      occurredAt: row.occurred_at,
      amountCents: amountFromPayload(row.audit_type, row.payload),
    });
  }
  return map;
}

function derivePaymentStatus(
  status: SubscriptionStatus,
  lastPayment: LastPaymentEvent | undefined,
): PlatformSubscriptionPaymentStatus {
  if (lastPayment?.auditType === STRIPE_BILLING_AUDIT_TYPES.invoicePaymentSucceeded) {
    return "succeeded";
  }
  if (lastPayment?.auditType === STRIPE_BILLING_AUDIT_TYPES.invoicePaymentFailed) {
    return "failed";
  }
  if (status === SubscriptionStatus.trialing || status === SubscriptionStatus.incomplete) {
    return "pending";
  }
  if (status === SubscriptionStatus.canceled) {
    return "none";
  }
  if (status === SubscriptionStatus.past_due || status === SubscriptionStatus.unpaid) {
    return "failed";
  }
  if (status === SubscriptionStatus.active) {
    return "succeeded";
  }
  return "none";
}

function isExpiredSubscription(
  status: SubscriptionStatus,
  trialEndsAt: Date | null,
  isTrial: boolean,
): boolean {
  if (status === SubscriptionStatus.incomplete || status === SubscriptionStatus.unpaid) {
    return true;
  }
  if (!isTrial && trialEndsAt && trialEndsAt < new Date() && status === SubscriptionStatus.canceled) {
    return true;
  }
  return false;
}

export async function countPlatformSubscriptionActivity(
  filter: PlatformSubscriptionActivityFilter,
): Promise<number> {
  const lastPayments = await loadLastPaymentEvents();
  const where = buildActivityWhere(filter, undefined, lastPayments);
  return prisma.subscription.count({ where });
}

export async function getPlatformSubscriptionOverview(): Promise<PlatformSubscriptionOverview> {
  const [active, trialing, successful, failed, cancelled, subs] = await Promise.all([
    countPlatformSubscriptionActivity("active"),
    countPlatformSubscriptionActivity("trialing"),
    countPlatformSubscriptionActivity("successful"),
    countPlatformSubscriptionActivity("failed"),
    countPlatformSubscriptionActivity("cancelled"),
    prisma.subscription.findMany({
      select: {
        status: true,
        isTrial: true,
        trialEndsAt: true,
      },
    }),
  ]);

  let expired = 0;
  for (const sub of subs) {
    if (isExpiredSubscription(sub.status, sub.trialEndsAt, sub.isTrial)) {
      expired += 1;
    }
  }

  return {
    active,
    trialing,
    successful,
    failed,
    cancelled,
    expired,
  };
}

export async function getPlatformSubscriptionWidgets(days = 30): Promise<PlatformSubscriptionWidgets> {
  const now = new Date();
  const todayStart = startOfUtcDay(now);
  const todayEnd = endOfUtcDay(now);
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - 7);
  const trialsEndingCutoff = new Date(now);
  trialsEndingCutoff.setDate(trialsEndingCutoff.getDate() + 7);

  const [intelligence, failedToday, failedWeek, trialsEndingSoon, renewalsDueToday] = await Promise.all([
    getSubscriptionIntelligence(days),
    prisma.subscriptionEvent.count({
      where: {
        auditType: STRIPE_BILLING_AUDIT_TYPES.invoicePaymentFailed,
        occurredAt: { gte: todayStart, lt: todayEnd },
      },
    }),
    prisma.subscriptionEvent.count({
      where: {
        auditType: STRIPE_BILLING_AUDIT_TYPES.invoicePaymentFailed,
        occurredAt: { gte: weekStart },
      },
    }),
    prisma.subscription.count({
      where: {
        status: SubscriptionStatus.trialing,
        trialEndsAt: { gte: now, lte: trialsEndingCutoff },
      },
    }),
    prisma.subscription.count({
      where: {
        OR: [
          { renewalDate: { gte: todayStart, lt: todayEnd } },
          { currentPeriodEnd: { gte: todayStart, lt: todayEnd } },
        ],
        status: { in: [SubscriptionStatus.active, SubscriptionStatus.trialing] },
      },
    }),
  ]);

  const paymentAttempts = intelligence.renewalsSucceeded + intelligence.paymentFailures;
  const successRatePercent =
    paymentAttempts > 0 ? Math.round((intelligence.renewalsSucceeded / paymentAttempts) * 100) : 100;

  return {
    successRatePercent,
    failedPaymentsToday: failedToday,
    failedPaymentsThisWeek: failedWeek,
    trialsEndingSoon,
    renewalsDueToday,
  };
}

export async function getPlatformSubscriptionMonitoringBundle(days = 30) {
  const { detectStripeBillingOrphans } = await import("../billingLifecycleIntegrity.service.js");
  const [overview, widgets, billingOrphans] = await Promise.all([
    getPlatformSubscriptionOverview(),
    getPlatformSubscriptionWidgets(days),
    detectStripeBillingOrphans(25),
  ]);
  return { overview, widgets, periodDays: days, billingOrphans };
}

const SORT_FIELDS = {
  date: "updatedAt",
  business: "business",
  status: "status",
  amount: "platformFeeCents",
} as const;

export type PlatformSubscriptionActivitySort = keyof typeof SORT_FIELDS;

function subscriptionIdsByLastPayment(auditType: string, lastPayments: Map<string, LastPaymentEvent>) {
  return [...lastPayments.entries()]
    .filter(([, event]) => event.auditType === auditType)
    .map(([id]) => id);
}

function buildActivityWhere(
  filter: PlatformSubscriptionActivityFilter,
  search: string | undefined,
  lastPayments: Map<string, LastPaymentEvent>,
): Prisma.SubscriptionWhereInput {
  const where: Prisma.SubscriptionWhereInput = {};

  if (search) {
    where.business = {
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { contactEmail: { contains: search, mode: "insensitive" } },
        { user: { email: { contains: search, mode: "insensitive" } } },
      ],
    };
  }

  if (filter === "active") {
    where.status = SubscriptionStatus.active;
  } else if (filter === "trialing") {
    where.status = SubscriptionStatus.trialing;
  } else if (filter === "cancelled") {
    where.status = SubscriptionStatus.canceled;
  } else if (filter === "past_due") {
    where.status = SubscriptionStatus.past_due;
  } else if (filter === "failed") {
    const failedIds = subscriptionIdsByLastPayment(
      STRIPE_BILLING_AUDIT_TYPES.invoicePaymentFailed,
      lastPayments,
    );
    where.OR = [
      { status: SubscriptionStatus.past_due },
      { status: SubscriptionStatus.unpaid },
      ...(failedIds.length > 0 ? [{ id: { in: failedIds } }] : []),
    ];
  } else if (filter === "successful") {
    const succeededIds = subscriptionIdsByLastPayment(
      STRIPE_BILLING_AUDIT_TYPES.invoicePaymentSucceeded,
      lastPayments,
    );
    where.OR = [
      { status: SubscriptionStatus.active, isTrial: false },
      ...(succeededIds.length > 0 ? [{ id: { in: succeededIds } }] : []),
    ];
  }

  return where;
}

export async function listPlatformSubscriptionActivity(params: {
  filter?: PlatformSubscriptionActivityFilter;
  q?: string;
  take: number;
  skip: number;
  sort?: PlatformSubscriptionActivitySort;
  sortDir?: "asc" | "desc";
}): Promise<{ items: PlatformSubscriptionActivityRow[]; total: number }> {
  const filter = params.filter ?? "all";
  const search = sanitizeLikeContainsSearch(params.q);
  const sortField = params.sort ?? "date";
  const sortDir = params.sortDir ?? "desc";

  const lastPayments = await loadLastPaymentEvents();
  const where = buildActivityWhere(filter, search, lastPayments);

  const orderBy: Prisma.SubscriptionOrderByWithRelationInput =
    sortField === "business"
      ? { business: { name: sortDir } }
      : sortField === "status"
        ? { status: sortDir }
        : sortField === "amount"
          ? { platformFeeCents: sortDir }
          : { updatedAt: sortDir };

  const [rows, total] = await Promise.all([
    prisma.subscription.findMany({
      where,
      orderBy,
      take: params.take,
      skip: params.skip,
      include: {
        business: {
          select: {
            id: true,
            name: true,
            contactEmail: true,
            user: { select: { email: true } },
          },
        },
      },
    }),
    prisma.subscription.count({ where }),
  ]);

  return {
    items: rows.map((sub) => mapActivityRow(sub, lastPayments.get(sub.id))),
    total,
  };
}

function mapActivityRow(
  sub: {
    id: string;
    planKey: string;
    billingCycle: string;
    status: SubscriptionStatus;
    platformFeeCents: number | null;
    currentPeriodEnd: Date | null;
    updatedAt: Date;
    business: {
      id: string;
      name: string;
      contactEmail: string | null;
      user: { email: string };
    };
  },
  lastPayment: LastPaymentEvent | undefined,
): PlatformSubscriptionActivityRow {
  const paymentStatus = derivePaymentStatus(sub.status, lastPayment);
  const amountCents =
    lastPayment?.amountCents ?? sub.platformFeeCents ?? null;

  return {
    businessId: sub.business.id,
    businessName: sub.business.name,
    contactEmail: sub.business.contactEmail ?? sub.business.user.email,
    planKey: sub.planKey,
    billingCycle: sub.billingCycle,
    status: sub.status,
    paymentStatus,
    amountCents,
    billingPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
    activityAt: (lastPayment?.occurredAt ?? sub.updatedAt).toISOString(),
    lastPaymentAttemptAt: lastPayment?.occurredAt.toISOString() ?? null,
  };
}
