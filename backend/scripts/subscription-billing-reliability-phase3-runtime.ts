/**
 * Phase 3 — reconciliation fairness + bounded notification retries (unit / mocked).
 */
import { SubscriptionBillingNotificationStatus } from "@prisma/client";
import {
  BILLING_RECONCILIATION_BATCH_SIZE_DEFAULT,
  BILLING_RECONCILIATION_BATCH_SIZE_MAX,
  resolveBillingReconciliationBatchSize,
} from "../src/config/billingReconciliationConfig.js";
import {
  BILLING_NOTIFICATION_MAX_SEND_ATTEMPTS_DEFAULT,
  BILLING_NOTIFICATION_RETRY_BACKOFF_MS_DEFAULT,
  computeBillingNotificationNextAttemptAt,
  isBillingNotificationSendEligible,
  resolveBillingNotificationMaxSendAttempts,
} from "../src/config/billingNotificationRetryPolicy.js";
import {
  buildEligibleBusinessesWhere,
  compareReconciliationBusinessKeys,
  resolveNextReconciliationCursor,
} from "../src/lib/subscription/billingReconciliationKeyset.js";
import {
  __resetBillingReconciliationCursorStateForTests,
  __setBillingReconciliationCursorStoreForTests,
  compareAndSwapBillingReconciliationCursor,
  loadBillingReconciliationCursorWithExpected,
} from "../src/services/subscriptionBillingReconciliationCursor.service.js";
import {
  classifyNotificationSendFailure,
  isSendingNotificationReclaimable,
} from "../src/services/subscriptionPaymentFailedNotification.service.js";
import { classifyResendHttpFailure } from "../src/services/resendClient.js";
import { BILLING_RECONCILIATION_BATCH_SIZE } from "../src/services/subscriptionBillingReconciliation.service.js";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

assert(
  resolveBillingReconciliationBatchSize({}) === BILLING_RECONCILIATION_BATCH_SIZE_DEFAULT,
  "default reconciliation batch 100",
);
assert(
  resolveBillingReconciliationBatchSize({ BILLING_RECONCILIATION_BATCH_SIZE: "999" }) ===
    BILLING_RECONCILIATION_BATCH_SIZE_MAX,
  "excessive batch capped",
);
assert(
  resolveBillingReconciliationBatchSize({ BILLING_RECONCILIATION_BATCH_SIZE: "0" }) ===
    BILLING_RECONCILIATION_BATCH_SIZE_DEFAULT,
  "invalid batch falls back",
);
assert(BILLING_RECONCILIATION_BATCH_SIZE === 100, "exported reconciliation batch size");

const businesses = [
  { id: "b2", createdAt: new Date("2020-01-01T00:00:00Z") },
  { id: "b1", createdAt: new Date("2020-01-01T00:00:00Z") },
  { id: "b3", createdAt: new Date("2020-01-02T00:00:00Z") },
].sort(compareReconciliationBusinessKeys);

assert(businesses[0]!.id === "b1", "tie-breaker id when createdAt equal");
const page1 = businesses.slice(0, 2);
const cursor1 = resolveNextReconciliationCursor(page1, 2);
assert(cursor1?.anchorBusinessId === "b2", "cursor lands on last row of full page");
const page2Where = buildEligibleBusinessesWhere(cursor1);
assert(
  JSON.stringify(page2Where).includes("b2") || JSON.stringify(page2Where).includes("gt"),
  "keyset where advances past cursor",
);
const wrap = resolveNextReconciliationCursor([businesses[2]!], 2);
assert(wrap === null, "partial page resets ring");

let memCursor: { anchorCreatedAt: Date; anchorBusinessId: string } | null = null;
__resetBillingReconciliationCursorStateForTests();
const memStore = {
  async loadWithExpected() {
    return {
      cursor: memCursor,
      expected: memCursor
        ? {
            kind: "present" as const,
            anchorCreatedAt: memCursor.anchorCreatedAt,
            anchorBusinessId: memCursor.anchorBusinessId,
          }
        : { kind: "absent" as const },
    };
  },
  async compareAndSwap(
    expected: { kind: "absent" } | { kind: "present"; anchorCreatedAt: Date; anchorBusinessId: string },
    next: { anchorCreatedAt: Date; anchorBusinessId: string } | null,
  ) {
    if (expected.kind === "absent" && memCursor !== null) {
      return { status: "stale_rejected" as const };
    }
    if (expected.kind === "present" && memCursor === null) {
      return { status: "stale_rejected" as const };
    }
    if (
      expected.kind === "present" &&
      memCursor &&
      (memCursor.anchorBusinessId !== expected.anchorBusinessId ||
        memCursor.anchorCreatedAt.getTime() !== expected.anchorCreatedAt.getTime())
    ) {
      return { status: "stale_rejected" as const };
    }
    memCursor = next;
    return { status: "saved" as const };
  },
};
__setBillingReconciliationCursorStoreForTests(memStore);

const loaded = await loadBillingReconciliationCursorWithExpected();
assert(loaded.cursor === null, "cursor starts absent");
const saved = await compareAndSwapBillingReconciliationCursor(loaded.expected, {
  anchorCreatedAt: businesses[0]!.createdAt,
  anchorBusinessId: businesses[0]!.id,
});
assert(saved.status === "saved", "cursor cas save");
const stale = await compareAndSwapBillingReconciliationCursor({ kind: "absent" }, null);
assert(stale.status === "stale_rejected", "concurrent cursor update rejected");
__setBillingReconciliationCursorStoreForTests(null);
__resetBillingReconciliationCursorStateForTests();

const maxAttempts = resolveBillingNotificationMaxSendAttempts({});
assert(maxAttempts === BILLING_NOTIFICATION_MAX_SEND_ATTEMPTS_DEFAULT, "max attempts default 5");
const backoff = [...BILLING_NOTIFICATION_RETRY_BACKOFF_MS_DEFAULT];
const t0 = new Date("2026-01-01T12:00:00Z");
const t1 = computeBillingNotificationNextAttemptAt({
  sendAttemptCount: 1,
  maxAttempts,
  backoffMs: backoff,
  now: t0,
});
assert(t1?.getTime() === t0.getTime() + 15 * 60 * 1000, "backoff after attempt 1 = 15m");
const t4 = computeBillingNotificationNextAttemptAt({
  sendAttemptCount: 4,
  maxAttempts,
  backoffMs: backoff,
  now: t0,
});
assert(t4?.getTime() === t0.getTime() + 2 * 60 * 60 * 1000, "backoff after attempt 4 = 2h");
assert(
  computeBillingNotificationNextAttemptAt({
    sendAttemptCount: 5,
    maxAttempts,
    backoffMs: backoff,
    now: t0,
  }) === null,
  "exhausted after 5 attempts",
);

const early = new Date("2026-01-01T12:00:00Z");
const later = new Date("2026-01-01T13:00:00Z");
assert(
  !isBillingNotificationSendEligible({
    status: "failed",
    sendAttemptCount: 1,
    maxAttempts: 5,
    nextAttemptAt: later,
    now: early,
  }),
  "not eligible before nextAttemptAt",
);
assert(
  isBillingNotificationSendEligible({
    status: "failed",
    sendAttemptCount: 4,
    maxAttempts: 5,
    nextAttemptAt: early,
    now: later,
  }),
  "eligible when nextAttemptAt passed",
);
assert(
  !isBillingNotificationSendEligible({
    status: "exhausted",
    sendAttemptCount: 5,
    maxAttempts: 5,
    nextAttemptAt: null,
    now: later,
  }),
  "exhausted never eligible",
);

assert(classifyNotificationSendFailure({ kind: "permanent", httpStatus: 422 }) === "permanent", "422 permanent");
assert(classifyNotificationSendFailure({ kind: "retryable", httpStatus: 503 }) === "retryable", "503 retryable");
assert(classifyResendHttpFailure(429, "{}").kind === "retryable", "rate limit retryable");

const staleAt = new Date(Date.now() - 11 * 60 * 1000);
assert(
  isSendingNotificationReclaimable(SubscriptionBillingNotificationStatus.sending, staleAt),
  "stale sending reclaimable",
);

console.log("subscription-billing-reliability-phase3-runtime: ok");
