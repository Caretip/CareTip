/**
 * Phase D3 — isolated observability unit tests (no DB, Stripe, or cron).
 */
import {
  __resetScheduledPayoutTickHeartbeatForTests,
  getScheduledPayoutTickHeartbeatDiagnostics,
  recordScheduledPayoutTickFailure,
  recordScheduledPayoutTickSuccess,
  classifyScheduledPayoutTickError,
} from "../src/services/scheduledBankPayoutTickHeartbeat.js";
import type { ScheduledBankPayoutTickCounts } from "../src/services/employeeScheduledBankPayout.service.js";
import {
  __setScheduledPayoutTickEmitFnForTests,
  buildScheduledPayoutTickObservabilitySummary,
  buildStreamTickMetrics,
  emitScheduledPayoutTickSummary,
  finalizeScheduledPayoutTickObservability,
  sanitizeBlockedReasonCountsForMetrics,
  sanitizeScheduledPayoutBlockedReasonForMetrics,
} from "../src/services/scheduledBankPayoutTickObservability.service.js";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function baseCounts(overrides: Partial<ScheduledBankPayoutTickCounts> = {}): ScheduledBankPayoutTickCounts {
  return {
    scanned: 0,
    processed: 0,
    created: 0,
    zero: 0,
    blocked: 0,
    notDue: 0,
    skipped: 0,
    retryScheduled: 0,
    blockedReasons: {},
    capReached: false,
    dueBacklogBefore: 0,
    dueBacklogAfter: 0,
    fairnessWraps: 0,
    cursorSave: "skipped",
    ...overrides,
  };
}

// --- sanitize blocked reasons ---
assert(
  sanitizeScheduledPayoutBlockedReasonForMetrics("reconciliation_required") === "reconciliation_required",
  "allowlisted reason",
);
assert(
  sanitizeScheduledPayoutBlockedReasonForMetrics("acct_123secret") === "other",
  "unknown reason → other",
);
const merged = sanitizeBlockedReasonCountsForMetrics({
  reconciliation_required: 1,
  "custom-unknown": 2,
});
assert(merged.reconciliation_required === 1 && merged.other === 2, "merge unknown into other");

// --- successful tick with mixed outcomes ---
const business = buildStreamTickMetrics({
  stream: "business",
  durationMs: 120,
  counts: baseCounts({
    scanned: 10,
    processed: 8,
    created: 3,
    zero: 2,
    blocked: 2,
    notDue: 1,
    capReached: false,
    dueBacklogBefore: 5,
    dueBacklogAfter: 2,
    blockedReasons: {
      processing_claim_held: 1,
      reconciliation_inconclusive: 1,
    },
  }),
  dueBacklogBefore: 5,
  dueBacklogAfter: 2,
});
const employee = buildStreamTickMetrics({
  stream: "employee",
  durationMs: 80,
  counts: baseCounts({
    scanned: 0,
    processed: 0,
    dueBacklogBefore: 0,
    dueBacklogAfter: 0,
  }),
  dueBacklogBefore: 0,
  dueBacklogAfter: 0,
});
const startedAt = Date.now() - 250;
const summary = buildScheduledPayoutTickObservabilitySummary({
  startedAtMs: startedAt,
  success: true,
  errorClass: null,
  streams: [business, employee],
});
assert(summary.success && summary.streams.length === 2, "two streams");
assert(summary.totals.created === 3 && summary.totals.blocked === 2, "totals aggregate");
assert(summary.totals.dueBacklogBefore === 5, "backlog before");
assert(summary.durationMs >= 200, "duration from wall clock");
assert(
  summary.metrics.some(
    (m) => m.name === "scheduled_payout_tick_duration_ms" && m.labels.result === "success",
  ),
  "duration metric",
);
assert(
  summary.metrics.some(
    (m) => m.name === "scheduled_payout_due_backlog_estimate" && m.labels.stream === "business",
  ),
  "backlog metric",
);
assert(
  summary.metrics.some((m) => m.name === "scheduled_payout_claim_conflict_total"),
  "claim conflict metric",
);

// --- zero due accounts is healthy ---
const empty = buildScheduledPayoutTickObservabilitySummary({
  startedAtMs: Date.now() - 10,
  success: true,
  errorClass: null,
  streams: [
    buildStreamTickMetrics({
      stream: "employee",
      durationMs: 5,
      counts: baseCounts(),
      dueBacklogBefore: 0,
      dueBacklogAfter: 0,
    }),
  ],
});
assert(empty.totals.accountsProcessed === 0 && empty.totals.dueBacklogBefore === 0, "healthy empty tick");

// --- backlog with zero processed ---
const backlogNoProcess = buildStreamTickMetrics({
  stream: "business",
  durationMs: 30,
  counts: baseCounts({
    dueBacklogBefore: 12,
    dueBacklogAfter: 12,
    capReached: true,
    processed: 0,
    scanned: 0,
  }),
  dueBacklogBefore: 12,
  dueBacklogAfter: 12,
});
assert(backlogNoProcess.capReached === true, "cap flag");
assert(backlogNoProcess.accountsProcessed === 0 && backlogNoProcess.dueBacklogBefore === 12, "backlog no process");

// --- cap saturation metric ---
const capSummary = buildScheduledPayoutTickObservabilitySummary({
  startedAtMs: Date.now() - 5,
  success: true,
  errorClass: null,
  streams: [
    buildStreamTickMetrics({
      stream: "business",
      durationMs: 5,
      counts: baseCounts({ capReached: true, processed: 200 }),
      dueBacklogBefore: 500,
      dueBacklogAfter: 400,
    }),
  ],
});
assert(
  capSummary.metrics.some((m) => m.name === "scheduled_payout_tick_cap_saturated"),
  "cap saturated metric",
);

// --- no sensitive labels ---
const forbidden = /acct_|po_|whsec_|sk_(live|test)_|@|c[a-z0-9]{20,}/i;
const allowedStream = new Set(["business", "employee"]);
for (const m of summary.metrics) {
  for (const [key, v] of Object.entries(m.labels)) {
    assert(!forbidden.test(v), `metric label must be bounded: ${m.name} ${JSON.stringify(m.labels)}`);
    if (key === "stream") assert(allowedStream.has(v), `stream label enum: ${v}`);
  }
}

// --- heartbeat ---
__resetScheduledPayoutTickHeartbeatForTests();
finalizeScheduledPayoutTickObservability({
  startedAtMs: Date.now() - 1,
  success: true,
  errorClass: null,
  streams: [business],
});
const hb = getScheduledPayoutTickHeartbeatDiagnostics();
assert(hb.lastSuccessAt != null && hb.consecutiveFailures === 0, "heartbeat success");
recordScheduledPayoutTickFailure("tick_exception");
assert(getScheduledPayoutTickHeartbeatDiagnostics().consecutiveFailures === 1, "failure increments");
assert(classifyScheduledPayoutTickError(new Error("x")) === "Error", "error class");

// --- emit failure must not throw ---
let emitCalls = 0;
__setScheduledPayoutTickEmitFnForTests(() => {
  emitCalls += 1;
  throw new Error("sink down");
});
emitScheduledPayoutTickSummary(empty);
assert(emitCalls === 1, "emit attempted");
__setScheduledPayoutTickEmitFnForTests(null);

// --- stream-level failure summary ---
const failed = buildScheduledPayoutTickObservabilitySummary({
  startedAtMs: Date.now() - 20,
  success: false,
  errorClass: "PrismaClientKnownRequestError",
  streams: [business],
});
assert(failed.success === false && failed.errorClass != null, "failed tick summary");

console.log("scheduled-bank-payout-tick-observability-runtime: ok");
