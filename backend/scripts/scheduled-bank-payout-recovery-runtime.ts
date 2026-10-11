/**
 * Phase A / A.1 — scheduled payout recovery unit tests (no live Stripe payouts).
 */
import {
  ScheduledPayoutFailureClassification,
  ScheduledPayoutReconciliationStatus,
  StripeConnectScheduledPayoutRequestStatus,
} from "@prisma/client";
import {
  SCHEDULED_PAYOUT_STRIPE_METADATA_CORRELATION_ID,
  SCHEDULED_PAYOUT_STRIPE_METADATA_WINDOW_KEY,
} from "../src/config/scheduledPayoutStripeMetadata.js";
import {
  canAttemptStripeCreateFromLedger,
  classifyStripePayoutError,
  computeScheduledPayoutNextRetryAt,
  diagnosticsToLedgerUpdate,
  extractStripePayoutCreateDiagnostics,
  gateScheduledLedgerBeforeCreate,
  isDefinitePreExecutionRetryableFailure,
  isLegacyFailedWithUnknownOutcome,
  mayCreateAfterReconcileNoMatch,
  reconcileScheduledPayoutWithStripe,
  resolveScheduledPayoutCreateAmount,
  sanitizeScheduledPayoutFailureMessage,
  SCHEDULED_PAYOUT_MAX_CREATE_ATTEMPTS,
  SCHEDULED_PAYOUT_STALE_PENDING_MS,
  __setListPayoutsForReconciliationFnForTests,
  __setRetrievePayoutForReconciliationFnForTests,
  reconciliationListResult,
} from "../src/services/scheduledBankPayoutRecovery.service.js";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const WINDOW_KEY = "2026-10-08T07:00:00.000Z";
const CHARLINE_AMOUNT = 9802;

const ledgerBase = {
  id: "led_1",
  scheduleWindowKey: WINDOW_KEY,
  idempotencyKey: `caretip_employee_scheduled_payout:emp:${WINDOW_KEY}`,
  amountCents: CHARLINE_AMOUNT,
  currency: "eur",
  stripePayoutId: null,
  failureCode: "stripe_create_failed",
  attemptCount: 1,
  nextRetryAt: null,
  failureClassification: null,
  reconciliationStatus: ScheduledPayoutReconciliationStatus.none,
  correlationId: null,
  createdAt: new Date("2026-10-08T07:00:58.000Z"),
  updatedAt: new Date("2026-10-08T07:00:58.000Z"),
};

assert(
  sanitizeScheduledPayoutFailureMessage("sk_live_abc123 secret").includes("[redacted]"),
  "sanitizes secrets",
);

assert(
  classifyStripePayoutError({ code: "rate_limit", type: "rate_limit_error", status: 429 }) ===
    ScheduledPayoutFailureClassification.retryable,
  "rate limit retryable",
);

const generic = extractStripePayoutCreateDiagnostics(new Error("socket hang up"));
assert(
  generic.failureClassification === ScheduledPayoutFailureClassification.outcome_uncertain,
  "network uncertain",
);

// 1. Legacy stripe_create_failed → reconciliation before retry
assert(isLegacyFailedWithUnknownOutcome({ ...ledgerBase, status: StripeConnectScheduledPayoutRequestStatus.failed }), "legacy detector");
assert(
  !canAttemptStripeCreateFromLedger({
    ...ledgerBase,
    status: StripeConnectScheduledPayoutRequestStatus.failed,
  }).allowed,
  "legacy failed cannot create without reconcile",
);
assert(
  canAttemptStripeCreateFromLedger({
    ...ledgerBase,
    status: StripeConnectScheduledPayoutRequestStatus.failed,
  }).reason === "reconciliation_required",
  "legacy reason reconciliation_required",
);

// 12. Retry backoff / exhaustion unchanged
const retryableFailed = {
  ...ledgerBase,
  status: StripeConnectScheduledPayoutRequestStatus.failed,
  failureClassification: ScheduledPayoutFailureClassification.retryable,
  attemptCount: 2,
  nextRetryAt: new Date(Date.now() + 60_000),
};
assert(
  !canAttemptStripeCreateFromLedger(retryableFailed).allowed &&
    canAttemptStripeCreateFromLedger(retryableFailed).reason === "reconciliation_required",
  "retryable failed requires reconcile before create",
);

const update = diagnosticsToLedgerUpdate(
  {
    stripeErrorCode: "rate_limit",
    stripeErrorType: "rate_limit_error",
    stripeHttpStatus: 429,
    stripeRequestId: "req_123",
    failureMessage: "Rate limit",
    failureClassification: ScheduledPayoutFailureClassification.retryable,
    failureCode: "rate_limit",
  },
  1,
);
assert(update.nextRetryAt !== null, "retry scheduled");
assert(update.blockedReason === "retry_scheduled", "retry reason");

assert(
  classifyStripePayoutError({ code: "balance_insufficient", type: null, status: 400 }) ===
    ScheduledPayoutFailureClassification.permanent,
  "balance permanent",
);

const next = computeScheduledPayoutNextRetryAt(1);
assert(next.getTime() > Date.now(), "next retry in future");

const exhausted = diagnosticsToLedgerUpdate(
  {
    stripeErrorCode: "rate_limit",
    stripeErrorType: "rate_limit_error",
    stripeHttpStatus: 429,
    stripeRequestId: "req_x",
    failureMessage: "Rate limit",
    failureClassification: ScheduledPayoutFailureClassification.retryable,
    failureCode: "rate_limit",
  },
  SCHEDULED_PAYOUT_MAX_CREATE_ATTEMPTS,
);
assert(exhausted.blockedReason === "retry_exhausted", "exhaustion");

// 3. Unrelated same amount/currency → never attached
__setListPayoutsForReconciliationFnForTests(async () =>
  reconciliationListResult([
  {
    id: "po_unrelated",
    object: "payout",
    amount: CHARLINE_AMOUNT,
    currency: "eur",
    metadata: {},
    created: Math.floor(Date.now() / 1000),
  } as import("stripe").Stripe.Payout,
]),
);
const unrelated = await reconcileScheduledPayoutWithStripe({
  stripeAccountId: "acct_test",
  ledger: {
    ...ledgerBase,
    correlationId: "corr_known",
    status: StripeConnectScheduledPayoutRequestStatus.failed,
    failureClassification: ScheduledPayoutFailureClassification.outcome_uncertain,
  },
});
assert(unrelated.kind === "inconclusive", "amount-only payout is inconclusive not matched");

// 4. Multiple metadata matches → inconclusive
__setListPayoutsForReconciliationFnForTests(async () =>
  reconciliationListResult([
  {
    id: "po_a",
    object: "payout",
    amount: CHARLINE_AMOUNT,
    currency: "eur",
    metadata: {
      [SCHEDULED_PAYOUT_STRIPE_METADATA_CORRELATION_ID]: "corr_multi",
      [SCHEDULED_PAYOUT_STRIPE_METADATA_WINDOW_KEY]: WINDOW_KEY,
    },
    created: Math.floor(Date.now() / 1000),
  } as import("stripe").Stripe.Payout,
  {
    id: "po_b",
    object: "payout",
    amount: CHARLINE_AMOUNT,
    currency: "eur",
    metadata: {
      [SCHEDULED_PAYOUT_STRIPE_METADATA_CORRELATION_ID]: "corr_multi",
      [SCHEDULED_PAYOUT_STRIPE_METADATA_WINDOW_KEY]: WINDOW_KEY,
    },
    created: Math.floor(Date.now() / 1000),
  } as import("stripe").Stripe.Payout,
]),
);
const multi = await reconcileScheduledPayoutWithStripe({
  stripeAccountId: "acct_test",
  ledger: {
    ...ledgerBase,
    correlationId: "corr_multi",
    status: StripeConnectScheduledPayoutRequestStatus.failed,
  },
});
assert(multi.kind === "inconclusive", "multiple metadata matches inconclusive");

// 5. List error → inconclusive
__setListPayoutsForReconciliationFnForTests(async () => {
  throw new Error("stripe_list_down");
});
const listErr = await reconcileScheduledPayoutWithStripe({
  stripeAccountId: "acct_test",
  ledger: { ...ledgerBase, correlationId: "corr_x", status: StripeConnectScheduledPayoutRequestStatus.failed },
});
assert(listErr.kind === "inconclusive", "list error inconclusive");

// 7. Confirmed payout ID on ledger → matched when retrieve agrees
__setListPayoutsForReconciliationFnForTests(null);
__setRetrievePayoutForReconciliationFnForTests(async () => ({
  id: "po_known",
  object: "payout",
  amount: CHARLINE_AMOUNT,
  currency: "eur",
} as import("stripe").Stripe.Payout));
const knownId = await reconcileScheduledPayoutWithStripe({
  stripeAccountId: "acct_test",
  ledger: {
    ...ledgerBase,
    stripePayoutId: "po_known",
    status: StripeConnectScheduledPayoutRequestStatus.pending,
  },
});
assert(knownId.kind === "matched" && knownId.stripePayoutId === "po_known", "known po_ reconciled");

// 2. Legacy + inconclusive reconciliation → no create (gate)
__setRetrievePayoutForReconciliationFnForTests(null);
__setListPayoutsForReconciliationFnForTests(async () => reconciliationListResult([]));
const gateLegacy = await gateScheduledLedgerBeforeCreate({
  stripeAccountId: "acct_test",
  ledger: {
    ...ledgerBase,
    status: StripeConnectScheduledPayoutRequestStatus.failed,
  },
  ledgerCreated: false,
  listPendingFn: async () => false,
});
assert(
  gateLegacy.action === "block" &&
    (gateLegacy.blockedReason === "reconciliation_inconclusive" ||
      gateLegacy.blockedReason === "reconciliation_no_match"),
  "legacy inconclusive gate blocks create",
);

// Metadata-confirmed reconcile via gate
const corrId = "corr_gate_ok";
__setListPayoutsForReconciliationFnForTests(async () =>
  reconciliationListResult([
  {
    id: "po_meta_ok",
    object: "payout",
    amount: CHARLINE_AMOUNT,
    currency: "eur",
    metadata: {
      [SCHEDULED_PAYOUT_STRIPE_METADATA_CORRELATION_ID]: corrId,
      [SCHEDULED_PAYOUT_STRIPE_METADATA_WINDOW_KEY]: WINDOW_KEY,
    },
    created: Math.floor(Date.now() / 1000),
  } as import("stripe").Stripe.Payout,
]),
);
const gateUncertain = await gateScheduledLedgerBeforeCreate({
  stripeAccountId: "acct_test",
  ledger: {
    ...ledgerBase,
    status: StripeConnectScheduledPayoutRequestStatus.failed,
    failureClassification: ScheduledPayoutFailureClassification.outcome_uncertain,
    reconciliationStatus: ScheduledPayoutReconciliationStatus.required,
    correlationId: corrId,
  },
  ledgerCreated: false,
  listPendingFn: async () => false,
});
assert(gateUncertain.action === "reconciled", "metadata match reconciles uncertain row");

// 6. Stale pending + no match → no blind create
const staleUpdated = new Date(Date.now() - SCHEDULED_PAYOUT_STALE_PENDING_MS - 5_000);
__setListPayoutsForReconciliationFnForTests(async () => reconciliationListResult([]));
const gateStale = await gateScheduledLedgerBeforeCreate({
  stripeAccountId: "acct_test",
  ledger: {
    ...ledgerBase,
    status: StripeConnectScheduledPayoutRequestStatus.pending,
    correlationId: "corr_stale",
    updatedAt: staleUpdated,
    createdAt: staleUpdated,
  },
  ledgerCreated: false,
  listPendingFn: async () => false,
});
assert(
  gateStale.action === "block" && gateStale.blockedReason === "stale_pending_no_stripe_match",
  "stale pending no_match does not proceed",
);

// Phase A.2
assert(
  classifyStripePayoutError({ code: "api_error", type: "api_error", status: 500 }) ===
    ScheduledPayoutFailureClassification.outcome_uncertain,
  "5xx classified outcome_uncertain",
);

const api500Diag = extractStripePayoutCreateDiagnostics(
  Object.assign(new Error("Internal server error"), {
    statusCode: 500,
    code: "api_error",
    type: "StripeAPIError",
  }),
);
assert(
  api500Diag.failureClassification === ScheduledPayoutFailureClassification.outcome_uncertain,
  "500 extract uncertain",
);

assert(
  !canAttemptStripeCreateFromLedger({
    ...ledgerBase,
    status: StripeConnectScheduledPayoutRequestStatus.failed,
    failureClassification: ScheduledPayoutFailureClassification.unknown,
    attemptCount: 1,
  }).allowed,
  "unknown classification blocked",
);

const timeoutDiag = extractStripePayoutCreateDiagnostics(new Error("socket hang up"));
const timeoutLedger = diagnosticsToLedgerUpdate(timeoutDiag, 1);
assert(timeoutLedger.reconciliationStatus === ScheduledPayoutReconciliationStatus.required, "timeout requires reconcile");

__setListPayoutsForReconciliationFnForTests(async () => reconciliationListResult([]));
const gate500Failed = await gateScheduledLedgerBeforeCreate({
  stripeAccountId: "acct_test",
  ledger: {
    ...ledgerBase,
    status: StripeConnectScheduledPayoutRequestStatus.failed,
    failureClassification: ScheduledPayoutFailureClassification.outcome_uncertain,
    reconciliationStatus: ScheduledPayoutReconciliationStatus.required,
    attemptCount: 1,
    correlationId: "corr_timeout",
  },
  ledgerCreated: false,
  listPendingFn: async () => false,
});
assert(
  gate500Failed.action === "block" && gate500Failed.blockedReason === "reconciliation_no_match",
  "ambiguous outcome no_match stays blocked",
);

const rateLimitFailed = {
  ...ledgerBase,
  status: StripeConnectScheduledPayoutRequestStatus.failed,
  failureClassification: ScheduledPayoutFailureClassification.retryable,
  failureCode: "rate_limit",
  attemptCount: 1,
  correlationId: "corr_rate_limit",
  nextRetryAt: new Date(Date.now() - 1_000),
};
assert(isDefinitePreExecutionRetryableFailure(rateLimitFailed), "rate limit definite retry");
assert(mayCreateAfterReconcileNoMatch(rateLimitFailed), "rate limit may create after reconcile no_match");

const gateRateRetry = await gateScheduledLedgerBeforeCreate({
  stripeAccountId: "acct_test",
  ledger: rateLimitFailed,
  ledgerCreated: false,
  listPendingFn: async () => false,
});
assert(gateRateRetry.action === "proceed", "rate limit reconcile no_match may proceed");

const amountSnap = resolveScheduledPayoutCreateAmount({
  ledgerAmountCents: 5000,
  ledgerCurrency: "eur",
  ledgerCreated: false,
  availableCents: 6000,
  balanceCurrency: "eur",
});
assert(amountSnap.ok && amountSnap.amountCents === 5000, "retry uses ledger amount");

const amountDrift = resolveScheduledPayoutCreateAmount({
  ledgerAmountCents: 5000,
  ledgerCurrency: "eur",
  ledgerCreated: false,
  availableCents: 4000,
  balanceCurrency: "eur",
});
assert(!amountDrift.ok && amountDrift.blockedReason === "insufficient_balance_for_ledger_amount", "balance drift blocked");

__setListPayoutsForReconciliationFnForTests(async () =>
  reconciliationListResult([
  {
    id: "po_wrong_meta",
    object: "payout",
    amount: CHARLINE_AMOUNT,
    currency: "eur",
    metadata: {
      [SCHEDULED_PAYOUT_STRIPE_METADATA_CORRELATION_ID]: "corr_wrong",
      [SCHEDULED_PAYOUT_STRIPE_METADATA_WINDOW_KEY]: "wrong_window",
    },
    created: Math.floor(Date.now() / 1000),
  } as import("stripe").Stripe.Payout,
]),
);
const wrongMeta = await reconcileScheduledPayoutWithStripe({
  stripeAccountId: "acct_test",
  ledger: {
    ...ledgerBase,
    correlationId: "corr_expected",
    status: StripeConnectScheduledPayoutRequestStatus.failed,
  },
});
assert(wrongMeta.kind === "inconclusive", "wrong metadata not attached");

__setListPayoutsForReconciliationFnForTests(async () =>
  reconciliationListResult([], false),
);
const incompleteSearch = await reconcileScheduledPayoutWithStripe({
  stripeAccountId: "acct_test",
  ledger: {
    ...ledgerBase,
    correlationId: "corr_incomplete",
    status: StripeConnectScheduledPayoutRequestStatus.failed,
  },
});
assert(incompleteSearch.kind === "inconclusive", "incomplete stripe search is inconclusive not no_match");

__setListPayoutsForReconciliationFnForTests(null);
__setRetrievePayoutForReconciliationFnForTests(null);

console.log("scheduled-bank-payout-recovery-runtime: ok");
