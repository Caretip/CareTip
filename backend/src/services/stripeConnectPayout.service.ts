/**
 * Stripe Connect payout observation (Phase 3).
 *
 * OBSERVE → VERIFY → ATTRIBUTE (event.account → Business.stripeAccountId)
 * → PERSIST → RECONCILE (paginated, resumable balance transactions) → DISPLAY.
 *
 * Observation only. CareTip does not initiate Stripe payouts.
 * Webhooks are primary; list APIs may run a throttled connected-account sync
 * so historical/missed payouts still appear (never platform payouts).
 */
import type Stripe from "stripe";
import { Prisma, StripeConnectPayoutReconciliationStatus, StripeConnectPayoutStatus } from "@prisma/client";
import { prisma } from "../prisma.js";
import { logServerError } from "../utils/httpErrors.js";
import { runSerializedByKey } from "../utils/serializedByKey.js";
import { getStripeClient } from "./stripe.service.js";
import {
  RECON_MAX_PAGES_WEBHOOK,
  reconcileConnectPayoutBalanceLines,
  reconStatusEligibleWhere,
} from "./stripeConnectPayoutReconciliation.service.js";

export {
  __setListPayoutBalanceTransactionsFnForTests,
  __setListPayoutBalanceTransactionPageFnForTests,
} from "./stripeConnectPayoutReconciliation.service.js";

/** Throttle opportunistic Stripe → DB sync on manager payout list (not continuous polling). */
export const CONNECT_PAYOUT_LIST_SYNC_TTL_MS = 60_000;
const CONNECT_PAYOUT_SYNC_PAGE_SIZE = 50;
const CONNECT_PAYOUT_SYNC_MAX_PAGES = 2;

export type ConnectPayoutListPage = {
  data: Stripe.Payout[];
  hasMore: boolean;
};

type ListConnectPayoutsFn = (
  stripeAccountId: string,
  opts: { startingAfter?: string; limit: number },
) => Promise<ConnectPayoutListPage | null>;

let listConnectPayoutsFn: ListConnectPayoutsFn | null = null;
const lastConnectPayoutSyncAtByBusiness = new Map<string, number>();

export function __setListConnectPayoutsFnForTests(fn: ListConnectPayoutsFn | null): void {
  listConnectPayoutsFn = fn;
}

export function __clearConnectPayoutSyncThrottleForTests(): void {
  lastConnectPayoutSyncAtByBusiness.clear();
}

async function listConnectPayoutsFromStripe(
  stripeAccountId: string,
  opts: { startingAfter?: string; limit: number },
): Promise<ConnectPayoutListPage | null> {
  if (listConnectPayoutsFn) {
    return listConnectPayoutsFn(stripeAccountId, opts);
  }
  const stripe = getStripeClient();
  const page = await stripe.payouts.list(
    {
      limit: opts.limit,
      ...(opts.startingAfter ? { starting_after: opts.startingAfter } : {}),
    },
    { stripeAccount: stripeAccountId },
  );
  return { data: page.data, hasMore: page.has_more };
}

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

type ParsedConnectPayout = NonNullable<ReturnType<typeof parsePayoutObject>>;

/**
 * Persist an attributed Connect payout snapshot (webhook or throttled API sync).
 * Caller must already resolve businessId ↔ stripeAccountId server-side.
 */
async function persistAttributedConnectPayout(args: {
  businessId: string;
  stripeAccountId: string;
  parsed: ParsedConnectPayout;
  eventCreated: number;
  eventType: string;
  eventId: string | null;
  runReconciliation: boolean;
}): Promise<HandleConnectPayoutResult> {
  const {
    businessId,
    stripeAccountId: accountId,
    parsed,
    eventCreated,
    eventType,
    eventId,
    runReconciliation,
  } = args;

  return runSerializedByKey(`connect-payout:${parsed.stripePayoutId}`, async () => {
    const now = new Date();
    const existing = await prisma.stripeConnectPayout.findUnique({
      where: { stripePayoutId: parsed.stripePayoutId },
    });

    if (existing) {
      if (eventId && existing.lastStripeEventId === eventId) {
        logPayoutOps("payout_duplicate", {
          payoutSuffix: parsed.stripePayoutId.slice(-8),
          eventType,
        });
      }
      if (existing.businessId !== businessId || existing.stripeAccountId !== accountId) {
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
          eventType,
        });
        if (runReconciliation) {
          if (existing.reconciliationStatus !== StripeConnectPayoutReconciliationStatus.complete) {
            await reconcileAfterPersist(existing.id, eventType);
          } else if (eventType === "payout.reconciliation_completed") {
            await reconcileAfterPersist(existing.id, eventType);
          }
        }
        return {
          matched: true,
          skippedStale: true,
          payoutRowId: existing.id,
          businessId,
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
          lastStripeEventType: eventType.slice(0, 64),
          lastStripeEventId: eventId ? eventId.slice(0, 128) : existing.lastStripeEventId,
          paidAt,
          failedAt,
          canceledAt,
        },
      });

      if (afterUpsertHook) await afterUpsertHook();

      logPayoutOps("payout_persisted", {
        businessId,
        payoutSuffix: parsed.stripePayoutId.slice(-8),
        reason: "updated",
        status: parsed.status,
      });
      if (parsed.status === StripeConnectPayoutStatus.failed) {
        logPayoutOps("payout_failed", {
          businessId,
          payoutSuffix: parsed.stripePayoutId.slice(-8),
          failureCode: parsed.failureCode,
        });
      }
      if (parsed.status === StripeConnectPayoutStatus.canceled) {
        logPayoutOps("payout_canceled", {
          businessId,
          payoutSuffix: parsed.stripePayoutId.slice(-8),
        });
      }

      if (runReconciliation) {
        await reconcileAfterPersist(existing.id, eventType);
      }

      return { matched: true, payoutRowId: existing.id, businessId, reason: "updated" };
    }

    const created = await prisma.stripeConnectPayout.create({
      data: {
        businessId,
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
        lastStripeEventType: eventType.slice(0, 64),
        lastStripeEventId: eventId ? eventId.slice(0, 128) : null,
        paidAt: parsed.status === StripeConnectPayoutStatus.paid ? now : null,
        failedAt: parsed.status === StripeConnectPayoutStatus.failed ? now : null,
        canceledAt: parsed.status === StripeConnectPayoutStatus.canceled ? now : null,
      },
    });

    if (afterUpsertHook) await afterUpsertHook();

    logPayoutOps("payout_persisted", {
      businessId,
      payoutSuffix: parsed.stripePayoutId.slice(-8),
      reason: "created",
      status: parsed.status,
    });
    if (parsed.status === StripeConnectPayoutStatus.failed) {
      logPayoutOps("payout_failed", {
        businessId,
        payoutSuffix: parsed.stripePayoutId.slice(-8),
        failureCode: parsed.failureCode,
      });
    }
    if (parsed.status === StripeConnectPayoutStatus.canceled) {
      logPayoutOps("payout_canceled", {
        businessId,
        payoutSuffix: parsed.stripePayoutId.slice(-8),
      });
    }

    if (runReconciliation) {
      await reconcileAfterPersist(created.id, eventType);
    }

    return { matched: true, payoutRowId: created.id, businessId, reason: "created" };
  });
}

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

  return persistAttributedConnectPayout({
    businessId: business.id,
    stripeAccountId: accountId,
    parsed,
    eventCreated,
    eventType: event.type,
    eventId: event.id,
    runReconciliation: true,
  });
}

export type SyncConnectPayoutsResult = {
  synced: number;
  skipped: boolean;
  reason?: string;
};

/**
 * Pull recent payouts from the business's connected Stripe account and upsert
 * observation rows. Uses Business.stripeAccountId only (never client-supplied).
 * Does not initiate payouts. Balance-line recon remains webhook/tick driven.
 */
export async function syncConnectPayoutsFromStripeForBusiness(
  businessId: string,
  opts?: { force?: boolean },
): Promise<SyncConnectPayoutsResult> {
  return runSerializedByKey(`connect-payout-sync:${businessId}`, async () => {
    const now = Date.now();
    const last = lastConnectPayoutSyncAtByBusiness.get(businessId) ?? 0;
    if (!opts?.force && now - last < CONNECT_PAYOUT_LIST_SYNC_TTL_MS) {
      return { synced: 0, skipped: true, reason: "throttled" };
    }

    const biz = await prisma.business.findUnique({
      where: { id: businessId },
      select: { stripeAccountId: true },
    });
    const accountId = biz?.stripeAccountId?.trim() ?? "";
    if (!accountId.startsWith("acct_")) {
      return { synced: 0, skipped: true, reason: "no_connect_account" };
    }

    lastConnectPayoutSyncAtByBusiness.set(businessId, now);

    let startingAfter: string | undefined;
    let synced = 0;
    const eventCreated = Math.floor(Date.now() / 1000);

    try {
      for (let page = 0; page < CONNECT_PAYOUT_SYNC_MAX_PAGES; page++) {
        const result = await listConnectPayoutsFromStripe(accountId, {
          startingAfter,
          limit: CONNECT_PAYOUT_SYNC_PAGE_SIZE,
        });
        if (!result) {
          logPayoutOps("payout_api_sync_failed", {
            businessId,
            accountSuffix: accountSuffix(accountId),
            reason: "list_returned_null",
          });
          return { synced, skipped: false, reason: "stripe_error" };
        }

        for (const payout of result.data) {
          const parsed = parsePayoutObject(payout);
          if (!parsed) continue;
          const persist = await persistAttributedConnectPayout({
            businessId,
            stripeAccountId: accountId,
            parsed,
            eventCreated,
            eventType: "payout.api_sync",
            eventId: `api_sync:${parsed.stripePayoutId}:${parsed.status}`,
            runReconciliation: false,
          });
          if (persist.matched && !persist.skippedStale) synced += 1;
          else if (persist.matched) synced += 1;
        }

        if (!result.hasMore || result.data.length === 0) break;
        startingAfter = result.data[result.data.length - 1]!.id;
      }
    } catch (err) {
      logServerError("stripe.connectPayout.api_sync", err, { businessId });
      return { synced, skipped: false, reason: "stripe_error" };
    }

    logPayoutOps("payout_api_sync", {
      businessId,
      accountSuffix: accountSuffix(accountId),
      synced,
    });
    return { synced, skipped: false, reason: "ok" };
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

  const existingCount = await prisma.stripeConnectPayout.count({ where });
  const sync = await syncConnectPayoutsFromStripeForBusiness(businessId, {
    force: existingCount === 0,
  });
  if (existingCount === 0 && sync.reason === "stripe_error") {
    throw new Error("Unable to synchronize payouts from Stripe. Please try again.");
  }

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
