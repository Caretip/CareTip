/**
 * Stripe Connect payout balance-transaction reconciliation (Phase 4).
 *
 * Observation only — never initiates payouts. Pagination is resumable.
 * Stripe API failures do not delete or reassign the payout row.
 */
import type Stripe from "stripe";
import { Prisma, StripeConnectPayoutReconciliationStatus } from "@prisma/client";
import { prisma } from "../prisma.js";
import { getStripeClient } from "./stripe.service.js";
import { logServerError } from "../utils/httpErrors.js";
import { runSerializedByKey } from "../utils/serializedByKey.js";

export const RECON_PAGE_SIZE = 100;
export const RECON_MAX_PAGES_WEBHOOK = 5;
export const RECON_MAX_PAGES_TICK = 20;
const STALE_IN_PROGRESS_MS = 5 * 60 * 1000;
const MAX_BACKOFF_MS = 15 * 60 * 1000;

export type BalanceTxLike = {
  id: string;
  type?: string;
  reporting_category?: string | null;
  amount: number;
  fee: number;
  net: number;
  currency: string;
  created: number;
};

export type BalanceTxPage = {
  data: BalanceTxLike[];
  hasMore: boolean;
  lastId: string | null;
};

type ListBalanceTxFn = (
  stripePayoutId: string,
  stripeAccountId: string,
) => Promise<BalanceTxLike[] | null>;

type ListBalanceTxPageFn = (args: {
  stripePayoutId: string;
  stripeAccountId: string;
  startingAfter: string | null;
  limit: number;
}) => Promise<BalanceTxPage | null>;

let listBalanceTxOverride: ListBalanceTxFn | null = null;
let listBalanceTxPageOverride: ListBalanceTxPageFn | null = null;

export function __setListPayoutBalanceTransactionsFnForTests(fn: ListBalanceTxFn | null): void {
  listBalanceTxOverride = fn;
}

export function __setListPayoutBalanceTransactionPageFnForTests(fn: ListBalanceTxPageFn | null): void {
  listBalanceTxPageOverride = fn;
}

function accountSuffix(accountId: string): string {
  return accountId.length <= 8 ? accountId : accountId.slice(-8);
}

function unixToDate(unix: number | null | undefined): Date | null {
  if (typeof unix !== "number" || !Number.isFinite(unix) || unix <= 0) return null;
  return new Date(unix * 1000);
}

function reconBackoffMs(attemptCount: number): number {
  const exp = Math.min(Math.max(attemptCount, 1), 8);
  return Math.min(30_000 * 2 ** (exp - 1), MAX_BACKOFF_MS);
}

function logPayoutOps(event: string, fields: Record<string, unknown>): void {
  console.info(`[stripe.connectPayout] ${event}`, fields);
}

async function listBalanceTxPage(args: {
  stripePayoutId: string;
  stripeAccountId: string;
  startingAfter: string | null;
  limit: number;
}): Promise<BalanceTxPage | null> {
  if (listBalanceTxPageOverride) {
    return listBalanceTxPageOverride(args);
  }
  if (listBalanceTxOverride) {
    if (args.startingAfter) {
      return { data: [], hasMore: false, lastId: null };
    }
    const all = await listBalanceTxOverride(args.stripePayoutId, args.stripeAccountId);
    if (all === null) return null;
    return {
      data: all,
      hasMore: false,
      lastId: all.length ? all[all.length - 1]!.id : null,
    };
  }
  try {
    const stripe = getStripeClient();
    const params: Stripe.BalanceTransactionListParams = {
      payout: args.stripePayoutId,
      limit: args.limit,
    };
    if (args.startingAfter) {
      params.starting_after = args.startingAfter;
    }
    const page = await stripe.balanceTransactions.list(params, {
      stripeAccount: args.stripeAccountId,
    });
    const data = page.data as BalanceTxLike[];
    return {
      data,
      hasMore: Boolean(page.has_more),
      lastId: data.length ? data[data.length - 1]!.id : null,
    };
  } catch (err) {
    logServerError("stripe.connectPayout.balanceTransactions", err, {
      payoutSuffix: args.stripePayoutId.slice(-8),
      accountSuffix: accountSuffix(args.stripeAccountId),
    });
    return null;
  }
}

async function persistBalanceLines(payoutRowId: string, lines: BalanceTxLike[]): Promise<number> {
  let written = 0;
  for (const bt of lines) {
    if (!bt.id || !Number.isInteger(bt.amount) || !Number.isInteger(bt.net)) continue;

    const existing = await prisma.stripeConnectPayoutBalanceLine.findUnique({
      where: { stripeBalanceTransactionId: bt.id },
      select: { payoutId: true },
    });
    if (existing && existing.payoutId !== payoutRowId) {
      logPayoutOps("payout_reconciliation_line_conflict", {
        payoutRowId,
        btSuffix: bt.id.slice(-8),
      });
      continue;
    }

    await prisma.stripeConnectPayoutBalanceLine.upsert({
      where: { stripeBalanceTransactionId: bt.id },
      create: {
        payoutId: payoutRowId,
        stripeBalanceTransactionId: bt.id,
        reportingCategory: (bt.reporting_category ?? null)?.toString().slice(0, 64) ?? null,
        type: String(bt.type ?? "unknown").slice(0, 64),
        amountCents: bt.amount,
        feeCents: Number.isInteger(bt.fee) ? bt.fee : 0,
        netCents: bt.net,
        currency: String(bt.currency ?? "eur").toLowerCase().slice(0, 8),
        createdAtStripe: unixToDate(bt.created) ?? new Date(),
      },
      update: {
        reportingCategory: (bt.reporting_category ?? null)?.toString().slice(0, 64) ?? null,
        type: String(bt.type ?? "unknown").slice(0, 64),
        amountCents: bt.amount,
        feeCents: Number.isInteger(bt.fee) ? bt.fee : 0,
        netCents: bt.net,
        currency: String(bt.currency ?? "eur").toLowerCase().slice(0, 8),
      },
    });
    written += 1;
  }
  return written;
}

export type ReconcilePayoutResult = {
  status: StripeConnectPayoutReconciliationStatus;
  linesWritten: number;
  reason: string;
};

/**
 * Resume or start Stripe BT listing for one payout. Idempotent. Never deletes the payout.
 */
export async function reconcileConnectPayoutBalanceLines(
  payoutRowId: string,
  opts?: { maxPages?: number },
): Promise<ReconcilePayoutResult> {
  const maxPages = Math.min(Math.max(opts?.maxPages ?? RECON_MAX_PAGES_WEBHOOK, 1), 50);

  return runSerializedByKey(`connect-payout-recon:${payoutRowId}`, async () => {
    const row = await prisma.stripeConnectPayout.findUnique({
      where: { id: payoutRowId },
    });
    if (!row) {
      return {
        status: StripeConnectPayoutReconciliationStatus.failed,
        linesWritten: 0,
        reason: "payout_missing",
      };
    }
    if (row.reconciliationStatus === StripeConnectPayoutReconciliationStatus.complete) {
      return {
        status: StripeConnectPayoutReconciliationStatus.complete,
        linesWritten: 0,
        reason: "already_complete",
      };
    }

    const now = new Date();
    await prisma.stripeConnectPayout.update({
      where: { id: row.id },
      data: {
        reconciliationStatus: StripeConnectPayoutReconciliationStatus.in_progress,
        reconciliationLastAttemptAt: now,
        reconciliationAttemptCount: { increment: 1 },
        reconciliationLastError: null,
      },
    });

    logPayoutOps("payout_reconciliation_started", {
      businessId: row.businessId,
      payoutSuffix: row.stripePayoutId.slice(-8),
      attempt: row.reconciliationAttemptCount + 1,
    });

    let cursor = row.reconciliationCursor;
    let linesWritten = 0;
    let pages = 0;
    let hasMore = row.reconciliationHasMore;

    while (pages < maxPages) {
      const page = await listBalanceTxPage({
        stripePayoutId: row.stripePayoutId,
        stripeAccountId: row.stripeAccountId,
        startingAfter: cursor,
        limit: RECON_PAGE_SIZE,
      });

      if (page === null) {
        await prisma.stripeConnectPayout.update({
          where: { id: row.id },
          data: {
            reconciliationStatus: StripeConnectPayoutReconciliationStatus.failed,
            reconciliationLastError: "stripe_unavailable",
            reconciliationLastAttemptAt: new Date(),
          },
        });
        logPayoutOps("payout_reconciliation_failed", {
          businessId: row.businessId,
          payoutSuffix: row.stripePayoutId.slice(-8),
          reason: "stripe_unavailable",
        });
        return {
          status: StripeConnectPayoutReconciliationStatus.failed,
          linesWritten,
          reason: "stripe_unavailable",
        };
      }

      linesWritten += await persistBalanceLines(row.id, page.data);
      pages += 1;
      hasMore = page.hasMore;
      if (page.lastId) cursor = page.lastId;

      await prisma.stripeConnectPayout.update({
        where: { id: row.id },
        data: {
          reconciliationCursor: cursor,
          reconciliationHasMore: hasMore,
        },
      });

      if (!hasMore) break;
    }

    if (!hasMore) {
      await prisma.stripeConnectPayout.update({
        where: { id: row.id },
        data: {
          reconciliationStatus: StripeConnectPayoutReconciliationStatus.complete,
          reconciliationHasMore: false,
          reconciliationLastError: null,
          reconciliationCompletedAt: new Date(),
          reconciliationLastAttemptAt: new Date(),
        },
      });
      logPayoutOps("payout_reconciliation_completed", {
        businessId: row.businessId,
        payoutSuffix: row.stripePayoutId.slice(-8),
        linesWritten,
      });
      return {
        status: StripeConnectPayoutReconciliationStatus.complete,
        linesWritten,
        reason: "complete",
      };
    }

    await prisma.stripeConnectPayout.update({
      where: { id: row.id },
      data: {
        reconciliationStatus: StripeConnectPayoutReconciliationStatus.partial,
        reconciliationHasMore: true,
        reconciliationCursor: cursor,
        reconciliationLastAttemptAt: new Date(),
      },
    });
    logPayoutOps("payout_reconciliation_partial", {
      businessId: row.businessId,
      payoutSuffix: row.stripePayoutId.slice(-8),
      pages,
      linesWritten,
    });
    return {
      status: StripeConnectPayoutReconciliationStatus.partial,
      linesWritten,
      reason: "page_cap",
    };
  });
}

export type TickConnectPayoutReconciliationResult = {
  scanned: number;
  attempted: number;
  completed: number;
  partial: number;
  failed: number;
  skipped: number;
};

/**
 * Cron-compatible recovery: resume incomplete / failed / stale in-progress reconciliation.
 * Does not initiate Stripe payouts.
 */
export async function tickConnectPayoutReconciliation(opts?: {
  limit?: number;
  maxPages?: number;
  now?: Date;
  ignoreBackoff?: boolean;
  payoutIds?: string[];
  businessId?: string;
}): Promise<TickConnectPayoutReconciliationResult> {
  const limit = Math.min(Math.max(opts?.limit ?? 20, 1), 100);
  const maxPages = opts?.maxPages ?? RECON_MAX_PAGES_TICK;
  const now = opts?.now ?? new Date();
  const staleBefore = new Date(now.getTime() - STALE_IN_PROGRESS_MS);

  const where: Prisma.StripeConnectPayoutWhereInput = {
    reconciliationStatus: {
      in: [
        StripeConnectPayoutReconciliationStatus.pending,
        StripeConnectPayoutReconciliationStatus.partial,
        StripeConnectPayoutReconciliationStatus.failed,
        StripeConnectPayoutReconciliationStatus.in_progress,
      ],
    },
  };
  if (opts?.payoutIds?.length) {
    where.id = { in: opts.payoutIds };
  }
  if (opts?.businessId) {
    where.businessId = opts.businessId;
  }

  const candidates = await prisma.stripeConnectPayout.findMany({
    where,
    orderBy: { reconciliationLastAttemptAt: { sort: "asc", nulls: "first" } },
    take: limit * 3,
    select: {
      id: true,
      reconciliationStatus: true,
      reconciliationAttemptCount: true,
      reconciliationLastAttemptAt: true,
    },
  });

  const result: TickConnectPayoutReconciliationResult = {
    scanned: candidates.length,
    attempted: 0,
    completed: 0,
    partial: 0,
    failed: 0,
    skipped: 0,
  };

  for (const row of candidates) {
    if (result.attempted >= limit) break;

    const last = row.reconciliationLastAttemptAt;
    const isStaleInProgress =
      row.reconciliationStatus === StripeConnectPayoutReconciliationStatus.in_progress &&
      (!last || last.getTime() <= staleBefore.getTime());
    const isInProgressFresh =
      row.reconciliationStatus === StripeConnectPayoutReconciliationStatus.in_progress && !isStaleInProgress;
    if (isInProgressFresh) {
      result.skipped += 1;
      continue;
    }

    if (!opts?.ignoreBackoff && last) {
      const wait = reconBackoffMs(row.reconciliationAttemptCount);
      if (last.getTime() + wait > now.getTime() && !isStaleInProgress) {
        result.skipped += 1;
        continue;
      }
    }

    result.attempted += 1;
    const recon = await reconcileConnectPayoutBalanceLines(row.id, { maxPages });
    if (recon.status === StripeConnectPayoutReconciliationStatus.complete) result.completed += 1;
    else if (recon.status === StripeConnectPayoutReconciliationStatus.partial) result.partial += 1;
    else if (recon.status === StripeConnectPayoutReconciliationStatus.failed) result.failed += 1;
  }

  return result;
}

export function reconStatusEligibleWhere(
  statusRaw: string | undefined,
): Prisma.StripeConnectPayoutWhereInput | null {
  const raw = statusRaw?.trim().toLowerCase();
  if (!raw || raw === "all") return null;
  const allowed = new Set(["pending", "in_progress", "complete", "partial", "failed"]);
  if (!allowed.has(raw)) return null;
  return { reconciliationStatus: raw as StripeConnectPayoutReconciliationStatus };
}
