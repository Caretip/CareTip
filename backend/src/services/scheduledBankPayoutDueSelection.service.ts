/**
 * Phase D2 — shared due predicates and keyset fetch for fair scheduled payout ticks.
 */
import { BusinessBankPayoutSchedule, Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import type {
  DueScheduledPayoutAccountRef,
  ScheduledPayoutFairnessCursor,
} from "./scheduledBankPayoutFairSelection.js";
import {
  compareAndSwapScheduledPayoutFairnessCursor,
  loadScheduledPayoutFairnessCursorWithExpected,
  logFairnessCursorCasStale,
  type FairnessCursorCasResult,
} from "./scheduledBankPayoutFairnessCursor.service.js";
import type { ScheduledPayoutFairnessStream } from "./scheduledBankPayoutFairSelection.js";
import {
  SCHEDULED_PAYOUT_TICK_BATCH_SIZE,
  SCHEDULED_PAYOUT_TICK_MAX_ACCOUNTS_PER_RUN,
} from "./scheduledBankPayoutRecovery.service.js";
import type { ScheduledBankPayoutRunResult } from "./scheduledBankPayoutRecovery.service.js";
import { logServerError } from "../utils/httpErrors.js";

export function employeeDueScheduledBankPayoutWhere(now: Date): Prisma.EmployeeStripeAccountWhereInput {
  return {
    bankPayoutSchedule: BusinessBankPayoutSchedule.every_3_days,
    bankPayoutNextScheduledAt: { lte: now },
    stripePayoutsEnabled: true,
    employee: {
      isDeleted: false,
      isActive: true,
      activationStatus: "active",
      user: { isActive: true, legalHold: false },
      business: { deletedAt: null, legalHold: false },
    },
  };
}

export function businessDueScheduledBankPayoutWhere(now: Date): Prisma.BusinessWhereInput {
  return {
    bankPayoutSchedule: BusinessBankPayoutSchedule.every_3_days,
    bankPayoutNextScheduledAt: { lte: now },
    deletedAt: null,
    legalHold: false,
    stripeAccountId: { not: null },
    stripePayoutsEnabled: true,
  };
}

function employeeKeysetAfterCursor(
  cursor: ScheduledPayoutFairnessCursor | null,
): Prisma.EmployeeStripeAccountWhereInput | undefined {
  if (!cursor) return undefined;
  return {
    OR: [
      { bankPayoutNextScheduledAt: { gt: cursor.anchorDueAt } },
      {
        bankPayoutNextScheduledAt: cursor.anchorDueAt,
        employeeId: { gt: cursor.anchorAccountId },
      },
    ],
  };
}

function businessKeysetAfterCursor(
  cursor: ScheduledPayoutFairnessCursor | null,
): Prisma.BusinessWhereInput | undefined {
  if (!cursor) return undefined;
  return {
    OR: [
      { bankPayoutNextScheduledAt: { gt: cursor.anchorDueAt } },
      {
        bankPayoutNextScheduledAt: cursor.anchorDueAt,
        id: { gt: cursor.anchorAccountId },
      },
    ],
  };
}

export async function fetchDueEmployeeScheduledBankPayoutBatch(args: {
  now: Date;
  after: ScheduledPayoutFairnessCursor | null;
  limit: number;
}): Promise<DueScheduledPayoutAccountRef[]> {
  const keyset = employeeKeysetAfterCursor(args.after);
  const rows = await prisma.employeeStripeAccount.findMany({
    where: keyset
      ? { AND: [employeeDueScheduledBankPayoutWhere(args.now), keyset] }
      : employeeDueScheduledBankPayoutWhere(args.now),
    select: { employeeId: true, bankPayoutNextScheduledAt: true },
    orderBy: [{ bankPayoutNextScheduledAt: "asc" }, { employeeId: "asc" }],
    take: args.limit,
  });
  return rows
    .filter((r) => r.bankPayoutNextScheduledAt != null)
    .map((r) => ({
      accountId: r.employeeId,
      dueAt: r.bankPayoutNextScheduledAt as Date,
    }));
}

export async function fetchDueBusinessScheduledBankPayoutBatch(args: {
  now: Date;
  after: ScheduledPayoutFairnessCursor | null;
  limit: number;
}): Promise<DueScheduledPayoutAccountRef[]> {
  const keyset = businessKeysetAfterCursor(args.after);
  const rows = await prisma.business.findMany({
    where: keyset
      ? { AND: [businessDueScheduledBankPayoutWhere(args.now), keyset] }
      : businessDueScheduledBankPayoutWhere(args.now),
    select: { id: true, bankPayoutNextScheduledAt: true },
    orderBy: [{ bankPayoutNextScheduledAt: "asc" }, { id: "asc" }],
    take: args.limit,
  });
  return rows
    .filter((r) => r.bankPayoutNextScheduledAt != null)
    .map((r) => ({
      accountId: r.id,
      dueAt: r.bankPayoutNextScheduledAt as Date,
    }));
}

export type FairScheduledPayoutTickAccumulator = {
  scanned: number;
  processed: number;
  created: number;
  zero: number;
  blocked: number;
  notDue: number;
  skipped: number;
  retryScheduled: number;
  blockedReasons: Record<string, number>;
  fairnessWraps: number;
  capReached: boolean;
  cursorSave: FairnessCursorCasResult["status"] | "skipped";
};

export async function runFairScheduledBankPayoutStreamTick(args: {
  stream: ScheduledPayoutFairnessStream;
  now: Date;
  fetchBatch: (
    after: ScheduledPayoutFairnessCursor | null,
    limit: number,
  ) => Promise<DueScheduledPayoutAccountRef[]>;
  processAccount: (accountId: string) => Promise<ScheduledBankPayoutRunResult>;
  onProcessError: (accountId: string, err: unknown) => void;
}): Promise<FairScheduledPayoutTickAccumulator> {
  const acc: FairScheduledPayoutTickAccumulator = {
    scanned: 0,
    processed: 0,
    created: 0,
    zero: 0,
    blocked: 0,
    notDue: 0,
    skipped: 0,
    retryScheduled: 0,
    blockedReasons: {},
    fairnessWraps: 0,
    capReached: false,
    cursorSave: "skipped",
  };

  const loaded = await loadScheduledPayoutFairnessCursorWithExpected(args.stream);
  const expectedAtLoad = loaded.expected;
  let localCursor: ScheduledPayoutFairnessCursor | null = loaded.cursor;
  const maxIterations = Math.ceil(
    SCHEDULED_PAYOUT_TICK_MAX_ACCOUNTS_PER_RUN / SCHEDULED_PAYOUT_TICK_BATCH_SIZE,
  );

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    if (acc.processed >= SCHEDULED_PAYOUT_TICK_MAX_ACCOUNTS_PER_RUN) break;

    let batch = await args.fetchBatch(localCursor, SCHEDULED_PAYOUT_TICK_BATCH_SIZE);
    if (batch.length === 0 && localCursor !== null) {
      acc.fairnessWraps += 1;
      localCursor = null;
      batch = await args.fetchBatch(null, SCHEDULED_PAYOUT_TICK_BATCH_SIZE);
    }
    if (batch.length === 0) break;

    acc.scanned += batch.length;

    for (const row of batch) {
      if (acc.processed >= SCHEDULED_PAYOUT_TICK_MAX_ACCOUNTS_PER_RUN) break;
      acc.processed += 1;
      localCursor = { anchorDueAt: row.dueAt, anchorAccountId: row.accountId };
      try {
        const result = await args.processAccount(row.accountId);
        if (result.outcome === "created") acc.created += 1;
        else if (result.outcome === "zero") acc.zero += 1;
        else if (result.outcome === "blocked") {
          acc.blocked += 1;
          const reason = result.blockedReason ?? "blocked";
          acc.blockedReasons[reason] = (acc.blockedReasons[reason] ?? 0) + 1;
          if (reason === "retry_scheduled" || reason === "retry_not_due") acc.retryScheduled += 1;
        } else if (result.outcome === "not_due") acc.notDue += 1;
        else if (result.outcome === "skipped") acc.skipped += 1;
      } catch (err) {
        args.onProcessError(row.accountId, err);
        acc.blocked += 1;
        acc.blockedReasons.tick_exception = (acc.blockedReasons.tick_exception ?? 0) + 1;
      }
    }

    if (batch.length < SCHEDULED_PAYOUT_TICK_BATCH_SIZE) break;
  }

  acc.capReached = acc.processed >= SCHEDULED_PAYOUT_TICK_MAX_ACCOUNTS_PER_RUN;

  if (localCursor) {
    try {
      const cas = await compareAndSwapScheduledPayoutFairnessCursor(
        args.stream,
        expectedAtLoad,
        localCursor,
      );
      acc.cursorSave = cas.status;
      if (cas.status === "stale_rejected") {
        logFairnessCursorCasStale(args.stream);
      }
    } catch (err) {
      logServerError("scheduledBankPayout.saveFairnessCursor", err, { stream: args.stream });
      throw err;
    }
  } else {
    acc.cursorSave = "skipped";
  }

  return acc;
}
