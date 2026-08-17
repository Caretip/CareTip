/**
 * Legacy erasure dual-clock backfill.
 *
 * New erasure requests write deletionCancelUntil (14d) and anonymizeEligibleAt (30d).
 * Rows requested before that schema may still have both clocks null.
 *
 * Default is dry-run. Apply requires an explicit confirm token AND subjectIds so a
 * blanket production write cannot happen by accident. Never changes accountStatus,
 * financial rows, or existing non-null clocks.
 */

import { prisma } from "../prisma.js";
import { computeErasureClocksFromRequestedAt } from "./lifecycleStatus.helpers.js";
import { logDryRunRecord, type RetentionDryRunRecord } from "./retentionDryRun.js";

export const ERASURE_CLOCK_BACKFILL_APPLY_TOKEN = "APPLY_ERASURE_CLOCK_BACKFILL" as const;

export type ErasureClockBackfillCandidate = {
  userId: string;
  deletionRequestedAt: string;
  wouldSetDeletionCancelUntil: string;
  wouldSetAnonymizeEligibleAt: string;
};

export type ErasureClockBackfillOptions = {
  /** Default true. When true, no UPDATE is issued. */
  dryRun?: boolean;
  /**
   * Must equal ERASURE_CLOCK_BACKFILL_APPLY_TOKEN together with dryRun:false
   * and non-empty subjectIds.
   */
  confirmApply?: string;
  /** Required when applying — never a blanket production write. */
  subjectIds?: string[];
  limit?: number;
};

export type ErasureClockBackfillResult = {
  dryRun: boolean;
  applied: number;
  skippedExistingClocks: number;
  candidates: ErasureClockBackfillCandidate[];
  records: RetentionDryRunRecord[];
};

function clocksAlreadyPresent(row: {
  deletionCancelUntil: Date | null;
  anonymizeEligibleAt: Date | null;
}): boolean {
  return row.deletionCancelUntil != null || row.anonymizeEligibleAt != null;
}

/**
 * Find erasure_pending users whose dual clocks were never stored.
 * Dry-run by default. Does not infer a request date — deletionRequestedAt must exist.
 */
export async function backfillMissingErasureClocks(
  opts?: ErasureClockBackfillOptions,
): Promise<ErasureClockBackfillResult> {
  const dryRunRequested = opts?.dryRun !== false;
  const applyRequested =
    opts?.confirmApply === ERASURE_CLOCK_BACKFILL_APPLY_TOKEN && dryRunRequested === false;
  if (applyRequested && !(opts?.subjectIds && opts.subjectIds.length > 0)) {
    throw new Error(
      "Erasure clock backfill apply requires explicit subjectIds (refusing blanket write)",
    );
  }

  const rows = await prisma.user.findMany({
    where: {
      accountStatus: "erasure_pending",
      deletionRequestedAt: { not: null },
      deletionCancelUntil: null,
      anonymizeEligibleAt: null,
    },
    select: {
      id: true,
      accountStatus: true,
      deletionRequestedAt: true,
      deletionCancelUntil: true,
      anonymizeEligibleAt: true,
    },
    take: opts?.limit ?? 500,
  });

  const allowed = applyRequested ? new Set(opts!.subjectIds) : null;
  const candidates: ErasureClockBackfillCandidate[] = [];
  const records: RetentionDryRunRecord[] = [];
  let skippedExistingClocks = 0;

  for (const row of rows) {
    if (!row.deletionRequestedAt) continue;
    if (clocksAlreadyPresent(row)) {
      skippedExistingClocks += 1;
      continue;
    }
    if (allowed && !allowed.has(row.id)) continue;

    const clocks = computeErasureClocksFromRequestedAt(row.deletionRequestedAt);
    const candidate: ErasureClockBackfillCandidate = {
      userId: row.id,
      deletionRequestedAt: row.deletionRequestedAt.toISOString(),
      wouldSetDeletionCancelUntil: clocks.deletionCancelUntil.toISOString(),
      wouldSetAnonymizeEligibleAt: clocks.anonymizeEligibleAt.toISOString(),
    };
    candidates.push(candidate);

    const record: RetentionDryRunRecord = {
      action: "WOULD_BACKFILL",
      category: "erasure_clocks",
      record: row.id,
      reason: "legacy_null_dual_clocks_from_deletionRequestedAt",
      retentionExpiry: clocks.anonymizeEligibleAt.toISOString(),
      legalHold: false,
      financialPreservation: "preserved",
    };
    records.push(record);
    logDryRunRecord(record);
  }

  let applied = 0;
  if (applyRequested) {
    for (const c of candidates) {
      const result = await prisma.user.updateMany({
        where: {
          id: c.userId,
          accountStatus: "erasure_pending",
          deletionRequestedAt: { not: null },
          deletionCancelUntil: null,
          anonymizeEligibleAt: null,
        },
        data: {
          deletionCancelUntil: new Date(c.wouldSetDeletionCancelUntil),
          anonymizeEligibleAt: new Date(c.wouldSetAnonymizeEligibleAt),
        },
      });
      applied += result.count;
    }
  }

  return {
    dryRun: !applyRequested,
    applied,
    skippedExistingClocks,
    candidates,
    records,
  };
}
