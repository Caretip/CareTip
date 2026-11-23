/**
 * Release dates for a connected account's pending Stripe balance.
 *
 * Stripe decides when each payment settles and records it as `available_on` on the
 * balance transaction. CareTip adds no hold of its own, so these dates are read from
 * Stripe rather than computed from settlement settings (which can disagree with what
 * Stripe actually applies).
 */
import type Stripe from "stripe";
import { getStripeClient } from "./stripe.service.js";
import { logServerError } from "../utils/httpErrors.js";

export type PendingReleaseDto = {
  /** ISO timestamp from Stripe `available_on` (start of the settlement day, UTC). */
  availableOn: string;
  amountCents: number;
};

export type PendingReleasesDto = {
  pendingReleases: PendingReleaseDto[] | null;
  /** True when the listed releases add up to the pending balance Stripe reported. */
  pendingReleasesComplete: boolean;
};

/** Stripe settlement can be extended up to 31 days; leave headroom for risk holds. */
const LOOKBACK_DAYS = 60;
/** Upper bound on balance transactions scanned per request. */
const MAX_SCANNED = 1000;

export type BalanceTxnLike = Pick<Stripe.BalanceTransaction, "status" | "currency" | "net" | "available_on">;

function listBalanceTransactions(stripeAccountId: string, createdGte: number): AsyncIterable<BalanceTxnLike> {
  return getStripeClient().balanceTransactions.list(
    { limit: 100, created: { gte: createdGte } },
    { stripeAccount: stripeAccountId },
  );
}

export const NO_PENDING_RELEASES: PendingReleasesDto = {
  pendingReleases: null,
  pendingReleasesComplete: false,
};

/** Groups pending transactions by release date. Pure; exported for tests. */
export function groupPendingReleases(
  txns: readonly BalanceTxnLike[],
  currency: string,
  pendingCents: number,
  truncated: boolean,
): PendingReleasesDto {
  const byDay = new Map<number, number>();
  for (const t of txns) {
    if (t.status !== "pending") continue;
    if (String(t.currency).toLowerCase() !== currency) continue;
    if (!Number.isInteger(t.net) || !Number.isInteger(t.available_on)) continue;
    byDay.set(t.available_on, (byDay.get(t.available_on) ?? 0) + t.net);
  }
  const releases = [...byDay.entries()]
    .filter(([, cents]) => cents !== 0)
    .sort(([a], [b]) => a - b)
    .map(([day, cents]) => ({ availableOn: new Date(day * 1000).toISOString(), amountCents: cents }));
  const total = releases.reduce((sum, r) => sum + r.amountCents, 0);
  return {
    pendingReleases: releases,
    pendingReleasesComplete: !truncated && total === pendingCents,
  };
}

export type PendingTxnScan = { txns: BalanceTxnLike[]; truncated: boolean };

/**
 * Lists recent balance transactions so it can run in parallel with the balance read.
 * Never throws: a failed lookup resolves to null so balances still render.
 */
export async function scanRecentBalanceTransactions(
  stripeAccountId: string,
  nowMs: number = Date.now(),
): Promise<PendingTxnScan | null> {
  const createdGte = Math.floor(nowMs / 1000) - LOOKBACK_DAYS * 86_400;
  try {
    const txns: BalanceTxnLike[] = [];
    let truncated = false;
    for await (const t of listBalanceTransactions(stripeAccountId, createdGte)) {
      if (txns.length >= MAX_SCANNED) {
        truncated = true;
        break;
      }
      txns.push(t);
    }
    return { txns, truncated };
  } catch (err) {
    logServerError("stripePendingReleases.list", err, {
      accountSuffix: stripeAccountId.slice(-8),
    });
    return null;
  }
}

export function pendingReleasesFromScan(
  scan: PendingTxnScan | null,
  currency: string,
  pendingCents: number,
): PendingReleasesDto {
  if (pendingCents === 0) return { pendingReleases: [], pendingReleasesComplete: true };
  if (!scan) return NO_PENDING_RELEASES;
  return groupPendingReleases(scan.txns, currency, pendingCents, scan.truncated);
}
