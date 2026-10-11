/**
 * Phase D3 — structured tick summaries for scheduled bank payouts (logs only; no metrics backend).
 */
import { SCHEDULED_PAYOUT_TICK_MAX_ACCOUNTS_PER_RUN } from "./scheduledBankPayoutRecovery.service.js";
import type { ScheduledBankPayoutTickCounts } from "./employeeScheduledBankPayout.service.js";
import type { ScheduledPayoutDueBacklogStream } from "./scheduledBankPayoutDueBacklog.service.js";
import {
  classifyScheduledPayoutTickError,
  recordScheduledPayoutTickFailure,
  recordScheduledPayoutTickSuccess,
} from "./scheduledBankPayoutTickHeartbeat.js";
import { getScheduledPayoutFairnessCursorRotationMode } from "./scheduledBankPayoutFairnessCursor.service.js";

export type ScheduledPayoutTickStreamMetrics = {
  stream: ScheduledPayoutDueBacklogStream;
  durationMs: number;
  accountsScanned: number;
  accountsProcessed: number;
  capReached: boolean;
  dueBacklogBefore: number;
  dueBacklogAfter: number;
  dueBacklogKind: "exact";
  outcomes: {
    created: number;
    zero: number;
    blocked: number;
    notDue: number;
    skipped: number;
    retryScheduled: number;
  };
  blockedReasons: Record<string, number>;
  claimConflictTotal: number;
  reconciliationBlockedTotal: number;
  fairnessWraps: number;
  cursorSave: ScheduledBankPayoutTickCounts["cursorSave"];
  fairnessCursorRotationMode: ReturnType<typeof getScheduledPayoutFairnessCursorRotationMode>;
};

export type ScheduledPayoutTickObservabilitySummary = {
  schema: "caretip.scheduled_payout_tick.v1";
  completedAt: string;
  durationMs: number;
  success: boolean;
  errorClass: string | null;
  streams: ScheduledPayoutTickStreamMetrics[];
  totals: {
    accountsScanned: number;
    accountsProcessed: number;
    created: number;
    zero: number;
    blocked: number;
    notDue: number;
    skipped: number;
    dueBacklogBefore: number;
    dueBacklogAfter: number;
    claimConflictTotal: number;
    reconciliationBlockedTotal: number;
  };
  /** Machine-readable metric lines (log-derived; not a deployed TSDB). */
  metrics: Array<{ name: string; value: number; labels: Record<string, string> }>;
};

const BLOCKED_REASON_ALLOWLIST = new Set([
  "blocked",
  "tick_exception",
  "retry_scheduled",
  "retry_not_due",
  "retry_exhausted",
  "permanent_failure",
  "stripe_create_failed",
  "outcome_uncertain",
  "reconciliation_required",
  "reconciliation_inconclusive",
  "reconciliation_no_match",
  "processing_claim_held",
  "processing_claim_heartbeat_lost",
  "pending_stripe_payout",
  "pending_payout_lookup_failed",
  "pending_in_flight",
  "stale_pending_reconcile",
  "stale_pending_no_stripe_match",
  "insufficient_balance_for_ledger_amount",
  "ledger_currency_mismatch",
  "ledger_window_not_current",
  "ledger_not_found",
  "no_scheduled_due",
  "already_submitted",
]);

const CLAIM_CONFLICT_REASONS = new Set([
  "processing_claim_held",
  "processing_claim_heartbeat_lost",
]);

const RECONCILIATION_BLOCKED_REASONS = new Set([
  "reconciliation_required",
  "reconciliation_inconclusive",
  "reconciliation_no_match",
  "stale_pending_reconcile",
  "stale_pending_no_stripe_match",
  "outcome_uncertain",
]);

export function sanitizeScheduledPayoutBlockedReasonForMetrics(raw: string): string {
  const trimmed = raw.trim().slice(0, 64);
  if (!trimmed) return "blocked";
  if (BLOCKED_REASON_ALLOWLIST.has(trimmed)) return trimmed;
  return "other";
}

export function sanitizeBlockedReasonCountsForMetrics(
  counts: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [reason, n] of Object.entries(counts)) {
    if (!Number.isFinite(n) || n <= 0) continue;
    const key = sanitizeScheduledPayoutBlockedReasonForMetrics(reason);
    out[key] = (out[key] ?? 0) + n;
  }
  return out;
}

function sumReasons(counts: Record<string, number>, reasons: Set<string>): number {
  let total = 0;
  for (const [reason, n] of Object.entries(counts)) {
    const key = sanitizeScheduledPayoutBlockedReasonForMetrics(reason);
    if (reasons.has(key) && Number.isFinite(n)) total += n;
  }
  return total;
}

export function buildStreamTickMetrics(args: {
  stream: ScheduledPayoutDueBacklogStream;
  durationMs: number;
  counts: ScheduledBankPayoutTickCounts;
  dueBacklogBefore: number;
  dueBacklogAfter: number;
}): ScheduledPayoutTickStreamMetrics {
  const blockedReasons = sanitizeBlockedReasonCountsForMetrics(args.counts.blockedReasons);
  return {
    stream: args.stream,
    durationMs: args.durationMs,
    accountsScanned: args.counts.scanned,
    accountsProcessed: args.counts.processed,
    capReached: args.counts.capReached,
    dueBacklogBefore: args.dueBacklogBefore,
    dueBacklogAfter: args.dueBacklogAfter,
    dueBacklogKind: "exact",
    outcomes: {
      created: args.counts.created,
      zero: args.counts.zero,
      blocked: args.counts.blocked,
      notDue: args.counts.notDue,
      skipped: args.counts.skipped,
      retryScheduled: args.counts.retryScheduled,
    },
    blockedReasons,
    claimConflictTotal: sumReasons(blockedReasons, CLAIM_CONFLICT_REASONS),
    reconciliationBlockedTotal: sumReasons(blockedReasons, RECONCILIATION_BLOCKED_REASONS),
    fairnessWraps: args.counts.fairnessWraps,
    cursorSave: args.counts.cursorSave,
    fairnessCursorRotationMode: getScheduledPayoutFairnessCursorRotationMode(),
  };
}

function pushOutcomeMetrics(
  metrics: Array<{ name: string; value: number; labels: Record<string, string> }>,
  stream: ScheduledPayoutDueBacklogStream,
  outcomes: ScheduledPayoutTickStreamMetrics["outcomes"],
): void {
  const base = { stream };
  if (outcomes.created > 0) {
    metrics.push({
      name: "scheduled_payout_outcome_total",
      value: outcomes.created,
      labels: { ...base, outcome: "created" },
    });
  }
  if (outcomes.zero > 0) {
    metrics.push({
      name: "scheduled_payout_outcome_total",
      value: outcomes.zero,
      labels: { ...base, outcome: "zero" },
    });
  }
  if (outcomes.blocked > 0) {
    metrics.push({
      name: "scheduled_payout_outcome_total",
      value: outcomes.blocked,
      labels: { ...base, outcome: "blocked" },
    });
  }
  if (outcomes.notDue > 0) {
    metrics.push({
      name: "scheduled_payout_outcome_total",
      value: outcomes.notDue,
      labels: { ...base, outcome: "not_due" },
    });
  }
  if (outcomes.skipped > 0) {
    metrics.push({
      name: "scheduled_payout_outcome_total",
      value: outcomes.skipped,
      labels: { ...base, outcome: "skipped" },
    });
  }
}

function pushBlockedReasonMetrics(
  metrics: Array<{ name: string; value: number; labels: Record<string, string> }>,
  stream: ScheduledPayoutDueBacklogStream,
  blockedReasons: Record<string, number>,
): void {
  for (const [reason, value] of Object.entries(blockedReasons)) {
    if (value <= 0) continue;
    metrics.push({
      name: "scheduled_payout_blocked_reason_total",
      value,
      labels: { stream, reason },
    });
  }
}

export function buildScheduledPayoutTickObservabilitySummary(args: {
  startedAtMs: number;
  success: boolean;
  errorClass: string | null;
  streams: ScheduledPayoutTickStreamMetrics[];
}): ScheduledPayoutTickObservabilitySummary {
  const durationMs = Math.max(0, Date.now() - args.startedAtMs);
  const metrics: ScheduledPayoutTickObservabilitySummary["metrics"] = [];

  metrics.push({
    name: "scheduled_payout_tick_duration_ms",
    value: durationMs,
    labels: { result: args.success ? "success" : "failure" },
  });

  let totals = {
    accountsScanned: 0,
    accountsProcessed: 0,
    created: 0,
    zero: 0,
    blocked: 0,
    notDue: 0,
    skipped: 0,
    dueBacklogBefore: 0,
    dueBacklogAfter: 0,
    claimConflictTotal: 0,
    reconciliationBlockedTotal: 0,
  };

  for (const s of args.streams) {
    totals.accountsScanned += s.accountsScanned;
    totals.accountsProcessed += s.accountsProcessed;
    totals.created += s.outcomes.created;
    totals.zero += s.outcomes.zero;
    totals.blocked += s.outcomes.blocked;
    totals.notDue += s.outcomes.notDue;
    totals.skipped += s.outcomes.skipped;
    totals.dueBacklogBefore += s.dueBacklogBefore;
    totals.dueBacklogAfter += s.dueBacklogAfter;
    totals.claimConflictTotal += s.claimConflictTotal;
    totals.reconciliationBlockedTotal += s.reconciliationBlockedTotal;

    metrics.push({
      name: "scheduled_payout_tick_accounts_scanned",
      value: s.accountsScanned,
      labels: { stream: s.stream },
    });
    metrics.push({
      name: "scheduled_payout_tick_accounts_processed",
      value: s.accountsProcessed,
      labels: { stream: s.stream },
    });
    metrics.push({
      name: "scheduled_payout_due_backlog_estimate",
      value: s.dueBacklogBefore,
      labels: { stream: s.stream, phase: "before" },
    });
    metrics.push({
      name: "scheduled_payout_due_backlog_estimate",
      value: s.dueBacklogAfter,
      labels: { stream: s.stream, phase: "after" },
    });
    if (s.capReached) {
      metrics.push({
        name: "scheduled_payout_tick_cap_saturated",
        value: 1,
        labels: { stream: s.stream, cap: String(SCHEDULED_PAYOUT_TICK_MAX_ACCOUNTS_PER_RUN) },
      });
    }
    if (s.claimConflictTotal > 0) {
      metrics.push({
        name: "scheduled_payout_claim_conflict_total",
        value: s.claimConflictTotal,
        labels: { stream: s.stream },
      });
    }
    if (s.reconciliationBlockedTotal > 0) {
      metrics.push({
        name: "scheduled_payout_reconcile_result_total",
        value: s.reconciliationBlockedTotal,
        labels: { stream: s.stream, result: "blocked_pending_recon" },
      });
    }
    if (s.fairnessWraps > 0) {
      metrics.push({
        name: "scheduled_payout_fairness_wrap_total",
        value: s.fairnessWraps,
        labels: { stream: s.stream },
      });
    }
    if (s.cursorSave === "stale_rejected") {
      metrics.push({
        name: "scheduled_payout_fairness_cursor_cas_total",
        value: 1,
        labels: { stream: s.stream, result: "stale_rejected" },
      });
    }
    if (s.fairnessCursorRotationMode === "legacy_unavailable") {
      metrics.push({
        name: "scheduled_payout_fairness_cursor_rotation_mode",
        value: 1,
        labels: { mode: "legacy_unavailable" },
      });
    }
    pushOutcomeMetrics(metrics, s.stream, s.outcomes);
    pushBlockedReasonMetrics(metrics, s.stream, s.blockedReasons);
  }

  return {
    schema: "caretip.scheduled_payout_tick.v1",
    completedAt: new Date().toISOString(),
    durationMs,
    success: args.success,
    errorClass: args.errorClass,
    streams: args.streams,
    totals,
    metrics,
  };
}

let emitFn: ((summary: ScheduledPayoutTickObservabilitySummary) => void) | null = null;

/** Test hook — capture emissions without console. */
export function __setScheduledPayoutTickEmitFnForTests(
  fn: ((summary: ScheduledPayoutTickObservabilitySummary) => void) | null,
): void {
  emitFn = fn;
}

export function emitScheduledPayoutTickSummary(summary: ScheduledPayoutTickObservabilitySummary): void {
  try {
    if (emitFn) {
      emitFn(summary);
      return;
    }
    console.info("[scheduled_payout_tick]", JSON.stringify(summary));
  } catch {
    // Observability must never affect payout processing.
  }
}

export function finalizeScheduledPayoutTickObservability(args: {
  startedAtMs: number;
  success: boolean;
  errorClass: string | null;
  streams: ScheduledPayoutTickStreamMetrics[];
}): ScheduledPayoutTickObservabilitySummary {
  const summary = buildScheduledPayoutTickObservabilitySummary(args);
  try {
    if (args.success) {
      recordScheduledPayoutTickSuccess(summary);
    } else if (args.errorClass) {
      recordScheduledPayoutTickFailure(args.errorClass);
    }
    emitScheduledPayoutTickSummary(summary);
  } catch {
    // Swallow — caller already has tick result.
  }
  return summary;
}

export function safeFinalizeScheduledPayoutTickOnError(
  startedAtMs: number,
  err: unknown,
  partialStreams: ScheduledPayoutTickStreamMetrics[] = [],
): ScheduledPayoutTickObservabilitySummary {
  const errorClass = classifyScheduledPayoutTickError(err);
  return finalizeScheduledPayoutTickObservability({
    startedAtMs,
    success: false,
    errorClass,
    streams: partialStreams,
  });
}
