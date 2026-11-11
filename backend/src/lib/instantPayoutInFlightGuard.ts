import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";

/**
 * A pending Instant Payout request younger than this blocks a new request (with a different
 * idempotency key) for the same connected account. Long enough to cover the Stripe create call;
 * short enough that a request stuck by a crash only blocks briefly.
 */
export const INSTANT_PAYOUT_IN_FLIGHT_WINDOW_MS = 2 * 60_000;

export function instantPayoutInFlightCutoff(nowMs = Date.now()): Date {
  return new Date(nowMs - INSTANT_PAYOUT_IN_FLIGHT_WINDOW_MS);
}

/**
 * Serialize "is another payout in flight? then record mine" for one account across every API
 * instance. The in-process queue only covers one process; this transaction-scoped advisory lock
 * covers all of them and works through the Supabase transaction pooler. The lock is released at
 * commit, before the Stripe call, so no connection is held while Stripe responds.
 */
export async function withInstantPayoutAccountLock<T>(
  scope: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`caretip.instant_payout.${scope}`}, 0))`;
      return fn(tx);
    },
    { maxWait: 10_000, timeout: 15_000 },
  );
}
