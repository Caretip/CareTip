/**
 * Phase D2 — pure keyset helpers for fair due-account rotation (no I/O).
 */
export type ScheduledPayoutFairnessStream = "business" | "employee";

export type ScheduledPayoutFairnessCursor = {
  anchorDueAt: Date;
  anchorAccountId: string;
};

export type DueScheduledPayoutAccountRef = {
  accountId: string;
  dueAt: Date;
};

export function compareDueAccountKey(
  a: { dueAt: Date; accountId: string },
  b: { dueAt: Date; accountId: string },
): number {
  const t = a.dueAt.getTime() - b.dueAt.getTime();
  if (t !== 0) return t;
  return a.accountId.localeCompare(b.accountId);
}

export function sortDueAccountRefs(refs: DueScheduledPayoutAccountRef[]): DueScheduledPayoutAccountRef[] {
  return [...refs].sort(compareDueAccountKey);
}

/** Accounts strictly after cursor in (dueAt, accountId) key order. */
export function dueAccountsAfterCursor(
  sortedDue: DueScheduledPayoutAccountRef[],
  cursor: ScheduledPayoutFairnessCursor | null,
): DueScheduledPayoutAccountRef[] {
  if (!cursor) return sortedDue;
  return sortedDue.filter((row) => {
    if (row.dueAt.getTime() > cursor.anchorDueAt.getTime()) return true;
    if (row.dueAt.getTime() < cursor.anchorDueAt.getTime()) return false;
    return row.accountId.localeCompare(cursor.anchorAccountId) > 0;
  });
}

export type FairBatchSelectResult = {
  batch: DueScheduledPayoutAccountRef[];
  /** Cursor after consuming this batch (last row), or null if batch empty. */
  cursorAfterBatch: ScheduledPayoutFairnessCursor | null;
  /** True when selection wrapped to the start of the due ring. */
  wrapped: boolean;
};

/**
 * Select up to `limit` due accounts, rotating after `cursor`.
 * When the tail is reached, wraps once to the head (does not skip accounts).
 */
export function selectFairDueAccountBatch(
  sortedDue: DueScheduledPayoutAccountRef[],
  cursor: ScheduledPayoutFairnessCursor | null,
  limit: number,
): FairBatchSelectResult {
  if (limit <= 0 || sortedDue.length === 0) {
    return { batch: [], cursorAfterBatch: cursor, wrapped: false };
  }
  let wrapped = false;
  let pool = dueAccountsAfterCursor(sortedDue, cursor);
  if (pool.length === 0 && cursor !== null) {
    wrapped = true;
    pool = sortedDue;
  }
  const batch = pool.slice(0, limit);
  const last = batch[batch.length - 1];
  const cursorAfterBatch = last
    ? { anchorDueAt: last.dueAt, anchorAccountId: last.accountId }
    : cursor;
  return { batch, cursorAfterBatch, wrapped };
}

export type FairTickSimulationOutcome = "advance" | "blocked" | "unchanged";

/**
 * Deterministic multi-tick simulation for regression tests (no DB).
 * `process` returns whether the account would leave the due queue (advance) or stay due (blocked/unchanged).
 */
export function simulateFairDueTicks(args: {
  dueAccounts: DueScheduledPayoutAccountRef[];
  maxAccountsPerTick: number;
  batchSize: number;
  tickCount: number;
  process: (accountId: string, tickIndex: number) => FairTickSimulationOutcome;
}): {
  attemptsByAccount: Map<string, number>;
  ticksWithAttempts: number[];
  wrapCount: number;
} {
  const sorted = sortDueAccountRefs(args.dueAccounts);
  let cursor: ScheduledPayoutFairnessCursor | null = null;
  const attemptsByAccount = new Map<string, number>();
  const ticksWithAttempts: number[] = [];
  let wrapCount = 0;

  for (let tick = 0; tick < args.tickCount; tick += 1) {
    let processedThisTick = 0;
    let iterations = 0;
    const maxIterations = Math.ceil(args.maxAccountsPerTick / args.batchSize);
    let localCursor: ScheduledPayoutFairnessCursor | null = cursor;

    while (processedThisTick < args.maxAccountsPerTick && iterations < maxIterations) {
      const { batch, cursorAfterBatch, wrapped } = selectFairDueAccountBatch(
        sorted,
        localCursor,
        args.batchSize,
      );
      if (wrapped) wrapCount += 1;
      if (batch.length === 0) break;

      for (const row of batch) {
        if (processedThisTick >= args.maxAccountsPerTick) break;
        processedThisTick += 1;
        attemptsByAccount.set(row.accountId, (attemptsByAccount.get(row.accountId) ?? 0) + 1);
        args.process(row.accountId, tick);
        localCursor = { anchorDueAt: row.dueAt, anchorAccountId: row.accountId };
      }
      iterations += 1;
      if (batch.length < args.batchSize) break;
    }

    cursor = localCursor;
    if (processedThisTick > 0) ticksWithAttempts.push(processedThisTick);
  }

  return { attemptsByAccount, ticksWithAttempts, wrapCount };
}
