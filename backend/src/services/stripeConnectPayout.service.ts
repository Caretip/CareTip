/**
 * Stripe Connect payout observation (Phase 3).
 *
 * OBSERVE → VERIFY → ATTRIBUTE (event.account → Business.stripeAccountId)
 * → PERSIST → RECONCILE (paginated, resumable balance transactions) → DISPLAY.
 *
 * Observation only. CareTip does not initiate Stripe payouts.
 */
import type Stripe from "stripe";
import { Prisma, StripeConnectPayoutReconciliationStatus, StripeConnectPayoutStatus } from "@prisma/client";
import { prisma } from "../prisma.js";
import { logServerError } from "../utils/httpErrors.js";
import { runSerializedByKey } from "../utils/serializedByKey.js";
import {
  RECON_MAX_PAGES_WEBHOOK,
  reconcileConnectPayoutBalanceLines,
  reconStatusEligibleWhere,
} from "./stripeConnectPayoutReconciliation.service.js";

export {
  __setListPayoutBalanceTransactionsFnForTests,
  __setListPayoutBalanceTransactionPageFnForTests,
} from "./stripeConnectPayoutReconciliation.service.js";

export const CONNECT_PAYOUT_EVENT_TYPES = new Set([
  "payout.created",
  "payout.updated",
  "payout.paid",
  "payout.failed",
  "payout.canceled",
  "payout.reconciliation_completed",
]);

export function isConnectPayoutEventType(eventType: string): boolean {
  return CONNECT_PAYOUT_EVENT_TYPES.has(eventType);
}

const STATUS_RANK: Record<StripeConnectPayoutStatus, number> = {
  unknown: 0,
  pending: 10,
  in_transit: 20,
  paid: 40,
  failed: 40,
  canceled: 40,
};

const TERMINAL_STATUSES = new Set<StripeConnectPayoutStatus>([
  StripeConnectPayoutStatus.paid,
  StripeConnectPayoutStatus.failed,
  StripeConnectPayoutStatus.canceled,
]);

export type PayoutApplyDecision = { apply: boolean; reason: string };

/**
 * Out-of-order protection:
 * 1. Older Stripe event.created never overwrites a newer accepted snapshot.
 * 2. paid / failed / canceled never regress to pending / in_transit.
 * 3. Terminal statuses do not switch to a different terminal on the same payout id.
 */
export function shouldApplyPayoutEvent(args: {
  storedStatus: StripeConnectPayoutStatus;
  storedEventCreated: number;
  incomingStatus: StripeConnectPayoutStatus;
  incomingEventCreated: number;
}): PayoutApplyDecision {
  const { storedStatus, storedEventCreated, incomingStatus, incomingEventCreated } = args;

  if (incomingEventCreated < storedEventCreated) {
    return { apply: false, reason: "stale_event" };
  }

  if (TERMINAL_STATUSES.has(storedStatus) && STATUS_RANK[incomingStatus] < STATUS_RANK[storedStatus]) {
    return { apply: false, reason: "terminal_regression" };
  }

  if (
    TERMINAL_STATUSES.has(storedStatus) &&
    TERMINAL_STATUSES.has(incomingStatus) &&
    storedStatus !== incomingStatus
  ) {
    return { apply: false, reason: "terminal_conflict" };
  }

  if (
    incomingEventCreated === storedEventCreated &&
    STATUS_RANK[incomingStatus] < STATUS_RANK[storedStatus]
  ) {
    return { apply: false, reason: "same_time_regression" };
  }

  return { apply: true, reason: "apply" };
}

export function mapStripePayoutStatus(raw: string | null | undefined): StripeConnectPayoutStatus {
  switch (String(raw ?? "").toLowerCase()) {
    case "pending":
      return StripeConnectPayoutStatus.pending;
    case "in_transit":
      return StripeConnectPayoutStatus.in_transit;
    case "paid":
      return StripeConnectPayoutStatus.paid;
    case "failed":
      return StripeConnectPayoutStatus.failed;
    case "canceled":
    case "cancelled":
      return StripeConnectPayoutStatus.canceled;
    default:
      return StripeConnectPayoutStatus.unknown;
  }
}

/** Display conversion only — integer cents remain the financial authority. */
export function payoutCentsToEur(cents: number): number {
  if (!Number.isInteger(cents)) {
    throw new Error("Payout amount must be integer cents");
  }
  return Number((cents / 100).toFixed(2));
}

export function sanitizePayoutFailureMessage(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = String(raw).trim().slice(0, 255);
  if (!s) return null;
  s = s.replace(/\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/gi, "[redacted]");
  s = s.replace(/\b\d{8,17}\b/g, "[redacted]");
  return s.slice(0, 255);
}

function logPayoutOps(event: string, fields: Record<string, unknown>): void {
  console.info(`[stripe.connectPayout] ${event}`, fields);
}

function accountSuffix(accountId: string): string {
  return accountId.length <= 8 ? accountId : accountId.slice(-8);
}

function unixToDate(unix: number | null | undefined): Date | null {
  if (typeof unix !== "number" || !Number.isFinite(unix) || unix <= 0) return null;
  return new Date(unix * 1000);
}

export type ConnectPayoutBalanceLineDto = {
  reportingCategory: string | null;
  type: string;
  amountCents: number;
  feeCents: number;
  netCents: number;
  amountEur: number;
  netEur: number;
  currency: string;
};

export type ConnectPayoutDto = {
  id: string;
  amountCents: number;
  amountEur: number;
  currency: string;
  status: StripeConnectPayoutStatus;
  arrivalDate: string | null;
  method: string | null;
  payoutType: string | null;
  description: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: string;
  stripeCreatedAt: string;
  paidAt: string | null;
  failedAt: string | null;
  canceledAt: string | null;
  reconciliationStatus: StripeConnectPayoutReconciliationStatus;
  balanceLineCount: number;
  balanceLines?: ConnectPayoutBalanceLineDto[];
};

export type PlatformConnectPayoutDto = ConnectPayoutDto & {
  businessId: string;
  businessName: string;
  stripeAccountSuffix: string;
};

type PayoutRow = {
  id: string;
  businessId: string;
  stripeAccountId: string;
  amountCents: number;
  currency: string;
  status: StripeConnectPayoutStatus;
  arrivalDate: Date | null;
  method: string | null;
  payoutType: string | null;
  description: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  stripeCreatedAt: Date;
  createdAt: Date;
  paidAt: Date | null;
  failedAt: Date | null;
  canceledAt: Date | null;
  reconciliationStatus?: StripeConnectPayoutReconciliationStatus;
  business?: { name: string };
  balanceLines?: Array<{
    reportingCategory: string | null;
    type: string;
    amountCents: number;
    feeCents: number;
    netCents: number;
    currency: string;
  }>;
  _count?: { balanceLines: number };
};

function mapBalanceLine(line: {
  reportingCategory: string | null;
  type: string;
  amountCents: number;
  feeCents: number;
  netCents: number;
  currency: string;
}): ConnectPayoutBalanceLineDto {
  return {
    reportingCategory: line.reportingCategory,
    type: line.type,
    amountCents: line.amountCents,
    feeCents: line.feeCents,
    netCents: line.netCents,
    amountEur: payoutCentsToEur(line.amountCents),
    netEur: payoutCentsToEur(line.netCents),
    currency: line.currency,
  };
}

function toPayoutDto(row: PayoutRow, includeLines: boolean): ConnectPayoutDto {
  const lineCount = row._count?.balanceLines ?? row.balanceLines?.length ?? 0;
  return {
    id: row.id,
    amountCents: row.amountCents,
    amountEur: payoutCentsToEur(row.amountCents),
    currency: row.currency,
    status: row.status,
    arrivalDate: row.arrivalDate?.toISOString() ?? null,
    method: row.method,
    payoutType: row.payoutType,
    description: row.description,
    failureCode: row.failureCode,
    failureMessage: row.failureMessage,
    createdAt: row.createdAt.toISOString(),
    stripeCreatedAt: row.stripeCreatedAt.toISOString(),
    paidAt: row.paidAt?.toISOString() ?? null,
    failedAt: row.failedAt?.toISOString() ?? null,
    canceledAt: row.canceledAt?.toISOString() ?? null,
    reconciliationStatus: row.reconciliationStatus ?? StripeConnectPayoutReconciliationStatus.pending,
    balanceLineCount: lineCount,
    ...(includeLines && row.balanceLines
      ? { balanceLines: row.balanceLines.map(mapBalanceLine) }
      : {}),
  };
}

function assertSafeDto(dto: ConnectPayoutDto | PlatformConnectPayoutDto): void {
  const raw = JSON.stringify(dto);
  if (
    /"iban"|routing|account_number|bank_account_number|sk_live|sk_test|whsec_/i.test(raw) ||
    /"destination":/.test(raw)
  ) {
    throw new Error("Payout DTO contained forbidden fields");
  }
}

let afterUpsertHook: (() => Promise<void>) | null = null;

export function __setPayoutHandlerAfterUpsertHookForTests(fn: (() => Promise<void>) | null): void {
  afterUpsertHook = fn;
}

async function maybeResetReconForStripeCompleted(payoutRowId: string, eventType: string): Promise<void> {
  if (eventType !== "payout.reconciliation_completed") return;
  await prisma.stripeConnectPayout.update({
    where: { id: payoutRowId },
    data: {
      reconciliationStatus: StripeConnectPayoutReconciliationStatus.pending,
      reconciliationCursor: null,
      reconciliationHasMore: true,
      reconciliationCompletedAt: null,
    },
  });
}

async function reconcileAfterPersist(payoutRowId: string, eventType: string): Promise<void> {
  try {
    await maybeResetReconForStripeCompleted(payoutRowId, eventType);
    await reconcileConnectPayoutBalanceLines(payoutRowId, { maxPages: RECON_MAX_PAGES_WEBHOOK });
  } catch (err) {
    logServerError("stripe.connectPayout.reconciliation", err, { payoutRowId });
  }
}

function parsePayoutObject(obj: Stripe.Payout): {
  stripePayoutId: string;
  amountCents: number;
  currency: string;
  status: StripeConnectPayoutStatus;
  arrivalDate: Date | null;
  method: string | null;
  payoutType: string | null;
  description: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  stripeCreatedAt: Date;
} | null {
  const stripePayoutId = obj.id?.trim();
  if (!stripePayoutId || !stripePayoutId.startsWith("po_")) return null;
  if (!Number.isInteger(obj.amount)) return null;
  const currency = String(obj.currency ?? "").toLowerCase().trim();
  if (!currency) return null;

  return {
    stripePayoutId,
    amountCents: obj.amount,
    currency: currency.slice(0, 8),
    status: mapStripePayoutStatus(obj.status),
    arrivalDate: unixToDate(obj.arrival_date),
    method: typeof obj.method === "string" ? obj.method.slice(0, 32) : null,
    payoutType: typeof obj.type === "string" ? obj.type.slice(0, 32) : null,
    description: typeof obj.description === "string" ? obj.description.slice(0, 255) : null,
    failureCode: typeof obj.failure_code === "string" ? obj.failure_code.slice(0, 64) : null,
    failureMessage: sanitizePayoutFailureMessage(obj.failure_message),
    stripeCreatedAt: unixToDate(obj.created) ?? new Date(),
  };
}

export type HandleConnectPayoutResult = {
  matched: boolean;
  skippedStale?: boolean;
  payoutRowId?: string | null;
  businessId?: string | null;
  reason?: string;
};

/**
 * Persist a verified Stripe payout event. Attribution is event.account only.
 */
export async function handleConnectPayoutEvent(event: Stripe.Event): Promise<HandleConnectPayoutResult> {
  if (!isConnectPayoutEventType(event.type)) {
    return { matched: false, reason: "ignored_type" };
  }

  const accountId =
    typeof event.account === "string" && event.account.trim().startsWith("acct_")
      ? event.account.trim()
      : null;
  if (!accountId) {
    logPayoutOps("payout_received", { eventType: event.type, reason: "missing_event_account" });
    console.info("[stripe.connectPayout] unmatched_missing_account", {
      eventType: event.type,
      eventId: event.id,
    });
    return { matched: false, reason: "missing_event_account" };
  }

  const parsed = parsePayoutObject(event.data.object as Stripe.Payout);
  if (!parsed) {
    console.warn("[stripe.connectPayout] invalid_payout_object", {
      eventType: event.type,
      eventId: event.id,
      accountSuffix: accountSuffix(accountId),
    });
    return { matched: false, reason: "invalid_payout_object" };
  }

  logPayoutOps("payout_received", {
    eventType: event.type,
    payoutSuffix: parsed.stripePayoutId.slice(-8),
    accountSuffix: accountSuffix(accountId),
    status: parsed.status,
  });

  return runSerializedByKey(`connect-payout:${parsed.stripePayoutId}`, async () => {
    const businesses = await prisma.business.findMany({
      where: { stripeAccountId: accountId },
      select: { id: true, stripeAccountId: true },
    });

    if (businesses.length !== 1) {
      console.info("[stripe.connectPayout] unmatched_account", {
        accountSuffix: accountSuffix(accountId),
        matchCount: businesses.length,
        eventType: event.type,
      });
      return { matched: false, reason: businesses.length === 0 ? "unknown_account" : "ambiguous_account" };
    }

    const business = businesses[0]!;
    const eventCreated = typeof event.created === "number" && event.created > 0 ? event.created : 0;
    const now = new Date();

    const existing = await prisma.stripeConnectPayout.findUnique({
      where: { stripePayoutId: parsed.stripePayoutId },
    });

    if (existing) {
      if (existing.lastStripeEventId === event.id) {
        logPayoutOps("payout_duplicate", {
          payoutSuffix: parsed.stripePayoutId.slice(-8),
          eventType: event.type,
        });
      }
      if (existing.businessId !== business.id || existing.stripeAccountId !== accountId) {
        logPayoutOps("payout_attribution_conflict", {
          payoutSuffix: parsed.stripePayoutId.slice(-8),
          accountSuffix: accountSuffix(accountId),
        });
        return { matched: false, reason: "attribution_conflict", payoutRowId: existing.id };
      }

      const decision = shouldApplyPayoutEvent({
        storedStatus: existing.status,
        storedEventCreated: existing.lastStripeEventCreated,
        incomingStatus: parsed.status,
        incomingEventCreated: eventCreated,
      });
      if (!decision.apply) {
        logPayoutOps("payout_stale_event", {
          reason: decision.reason,
          payoutSuffix: parsed.stripePayoutId.slice(-8),
          eventType: event.type,
        });
        if (existing.reconciliationStatus !== StripeConnectPayoutReconciliationStatus.complete) {
          await reconcileAfterPersist(existing.id, event.type);
        } else if (event.type === "payout.reconciliation_completed") {
          await reconcileAfterPersist(existing.id, event.type);
        }
        return {
          matched: true,
          skippedStale: true,
          payoutRowId: existing.id,
          businessId: business.id,
          reason: decision.reason,
        };
      }

      const paidAt =
        parsed.status === StripeConnectPayoutStatus.paid ? (existing.paidAt ?? now) : existing.paidAt;
      const failedAt =
        parsed.status === StripeConnectPayoutStatus.failed ? (existing.failedAt ?? now) : existing.failedAt;
      const canceledAt =
        parsed.status === StripeConnectPayoutStatus.canceled
          ? (existing.canceledAt ?? now)
          : existing.canceledAt;

      await prisma.stripeConnectPayout.update({
        where: { id: existing.id },
        data: {
          amountCents: parsed.amountCents,
          currency: parsed.currency,
          status: parsed.status,
          arrivalDate: parsed.arrivalDate,
          method: parsed.method,
          payoutType: parsed.payoutType,
          description: parsed.description,
          failureCode:
            parsed.status === StripeConnectPayoutStatus.failed
              ? parsed.failureCode
              : existing.failureCode,
          failureMessage:
            parsed.status === StripeConnectPayoutStatus.failed
              ? parsed.failureMessage
              : existing.failureMessage,
          stripeCreatedAt: parsed.stripeCreatedAt,
          lastStripeEventCreated: eventCreated,
          lastStripeEventType: event.type.slice(0, 64),
          lastStripeEventId: event.id.slice(0, 128),
          paidAt,
          failedAt,
          canceledAt,
        },
      });

      if (afterUpsertHook) await afterUpsertHook();

      logPayoutOps("payout_persisted", {
        businessId: business.id,
        payoutSuffix: parsed.stripePayoutId.slice(-8),
        reason: "updated",
        status: parsed.status,
      });
      if (parsed.status === StripeConnectPayoutStatus.failed) {
        logPayoutOps("payout_failed", {
          businessId: business.id,
          payoutSuffix: parsed.stripePayoutId.slice(-8),
          failureCode: parsed.failureCode,
        });
      }
      if (parsed.status === StripeConnectPayoutStatus.canceled) {
        logPayoutOps("payout_canceled", {
          businessId: business.id,
          payoutSuffix: parsed.stripePayoutId.slice(-8),
        });
      }

      await reconcileAfterPersist(existing.id, event.type);

      return { matched: true, payoutRowId: existing.id, businessId: business.id, reason: "updated" };
    }

    const created = await prisma.stripeConnectPayout.create({
      data: {
        businessId: business.id,
        stripeAccountId: accountId,
        stripePayoutId: parsed.stripePayoutId,
        amountCents: parsed.amountCents,
        currency: parsed.currency,
        status: parsed.status,
        arrivalDate: parsed.arrivalDate,
        method: parsed.method,
        payoutType: parsed.payoutType,
        description: parsed.description,
        failureCode: parsed.status === StripeConnectPayoutStatus.failed ? parsed.failureCode : null,
        failureMessage: parsed.status === StripeConnectPayoutStatus.failed ? parsed.failureMessage : null,
        stripeCreatedAt: parsed.stripeCreatedAt,
        lastStripeEventCreated: eventCreated,
        lastStripeEventType: event.type.slice(0, 64),
        lastStripeEventId: event.id.slice(0, 128),
        paidAt: parsed.status === StripeConnectPayoutStatus.paid ? now : null,
        failedAt: parsed.status === StripeConnectPayoutStatus.failed ? now : null,
        canceledAt: parsed.status === StripeConnectPayoutStatus.canceled ? now : null,
      },
    });

    if (afterUpsertHook) await afterUpsertHook();

    logPayoutOps("payout_persisted", {
      businessId: business.id,
      payoutSuffix: parsed.stripePayoutId.slice(-8),
      reason: "created",
      status: parsed.status,
    });
    if (parsed.status === StripeConnectPayoutStatus.failed) {
      logPayoutOps("payout_failed", {
        businessId: business.id,
        payoutSuffix: parsed.stripePayoutId.slice(-8),
        failureCode: parsed.failureCode,
      });
    }
    if (parsed.status === StripeConnectPayoutStatus.canceled) {
      logPayoutOps("payout_canceled", {
        businessId: business.id,
        payoutSuffix: parsed.stripePayoutId.slice(-8),
      });
    }

    await reconcileAfterPersist(created.id, event.type);

    return { matched: true, payoutRowId: created.id, businessId: business.id, reason: "created" };
  });
}

const payoutListSelect = {
  id: true,
  businessId: true,
  stripeAccountId: true,
  amountCents: true,
  currency: true,
  status: true,
  arrivalDate: true,
  method: true,
  payoutType: true,
  description: true,
  failureCode: true,
  failureMessage: true,
  stripeCreatedAt: true,
  createdAt: true,
  paidAt: true,
  failedAt: true,
  canceledAt: true,
  reconciliationStatus: true,
  _count: { select: { balanceLines: true } },
} as const;

export async function listPayoutsForBusiness(
  businessId: string,
  opts?: { take?: number; skip?: number },
): Promise<{ items: ConnectPayoutDto[]; total: number }> {
  const take = Math.min(Math.max(opts?.take ?? 50, 1), 100);
  const skip = Math.max(opts?.skip ?? 0, 0);
  const where = { businessId };

  const [total, rows] = await Promise.all([
    prisma.stripeConnectPayout.count({ where }),
    prisma.stripeConnectPayout.findMany({
      where,
      orderBy: { stripeCreatedAt: "desc" },
      take,
      skip,
      select: payoutListSelect,
    }),
  ]);

  const items = rows.map((row) => {
    const dto = toPayoutDto(row, false);
    assertSafeDto(dto);
    return dto;
  });
  return { items, total };
}

export async function getPayoutForBusiness(
  businessId: string,
  payoutId: string,
): Promise<ConnectPayoutDto | null> {
  const row = await prisma.stripeConnectPayout.findFirst({
    where: { id: payoutId, businessId },
    include: { balanceLines: { orderBy: { createdAtStripe: "desc" } } },
  });
  if (!row) return null;
  const dto = toPayoutDto(
    {
      ...row,
      _count: { balanceLines: row.balanceLines.length },
    },
    true,
  );
  assertSafeDto(dto);
  return dto;
}

export async function listPlatformConnectPayouts(opts?: {
  take?: number;
  skip?: number;
  businessId?: string;
  status?: string;
  reconciliationStatus?: string;
  currency?: string;
  createdFrom?: string;
  createdTo?: string;
  q?: string;
}): Promise<{ items: PlatformConnectPayoutDto[]; total: number }> {
  const take = Math.min(Math.max(opts?.take ?? 50, 1), 100);
  const skip = Math.max(opts?.skip ?? 0, 0);

  const and: Prisma.StripeConnectPayoutWhereInput[] = [];
  if (opts?.businessId?.trim()) {
    and.push({ businessId: opts.businessId.trim() });
  }
  const statusRaw = opts?.status?.trim().toLowerCase();
  if (statusRaw && statusRaw !== "all") {
    const mapped = mapStripePayoutStatus(statusRaw);
    if (mapped !== StripeConnectPayoutStatus.unknown || statusRaw === "unknown") {
      and.push({ status: mapped });
    }
  }
  const reconWhere = reconStatusEligibleWhere(opts?.reconciliationStatus);
  if (reconWhere) and.push(reconWhere);
  const currency = opts?.currency?.trim().toLowerCase();
  if (currency) {
    and.push({ currency });
  }
  const from = opts?.createdFrom?.trim();
  if (from) {
    const d = new Date(from);
    if (!Number.isNaN(d.getTime())) and.push({ stripeCreatedAt: { gte: d } });
  }
  const to = opts?.createdTo?.trim();
  if (to) {
    const d = new Date(to);
    if (!Number.isNaN(d.getTime())) and.push({ stripeCreatedAt: { lte: d } });
  }
  const q = opts?.q?.trim();
  if (q) {
    and.push({
      OR: [
        { business: { name: { contains: q, mode: "insensitive" } } },
        { id: { contains: q, mode: "insensitive" } },
      ],
    });
  }

  const where: Prisma.StripeConnectPayoutWhereInput = and.length ? { AND: and } : {};

  const [total, rows] = await Promise.all([
    prisma.stripeConnectPayout.count({ where }),
    prisma.stripeConnectPayout.findMany({
      where,
      orderBy: { stripeCreatedAt: "desc" },
      take,
      skip,
      select: {
        ...payoutListSelect,
        business: { select: { name: true } },
      },
    }),
  ]);

  const items = rows.map((row) => {
    const dto: PlatformConnectPayoutDto = {
      ...toPayoutDto(row, false),
      businessId: row.businessId,
      businessName: row.business.name,
      stripeAccountSuffix: accountSuffix(row.stripeAccountId),
    };
    assertSafeDto(dto);
    return dto;
  });
  return { items, total };
}

export async function getPlatformConnectPayout(payoutId: string): Promise<PlatformConnectPayoutDto | null> {
  const row = await prisma.stripeConnectPayout.findFirst({
    where: { id: payoutId },
    include: {
      business: { select: { name: true } },
      balanceLines: { orderBy: { createdAtStripe: "desc" } },
    },
  });
  if (!row) return null;
  const dto: PlatformConnectPayoutDto = {
    ...toPayoutDto(
      {
        ...row,
        _count: { balanceLines: row.balanceLines.length },
      },
      true,
    ),
    businessId: row.businessId,
    businessName: row.business.name,
    stripeAccountSuffix: accountSuffix(row.stripeAccountId),
  };
  assertSafeDto(dto);
  return dto;
}

export const __test = {
  shouldApplyPayoutEvent,
  mapStripePayoutStatus,
  sanitizePayoutFailureMessage,
  payoutCentsToEur,
};
