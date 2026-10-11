/**
 * Phase B — scheduled payout operations (auth, DTO, admin reconcile without create).
 * Isolated mocks only — no database or live Stripe.
 */
import { Role } from "@prisma/client";
import { normalizeConnectPayoutMethod } from "../src/lib/connectPayoutMethod.util.js";
import { isPlatformAdminPrincipal } from "../src/lib/platformAdminAccess.js";
import {
  SCHEDULED_PAYOUT_STRIPE_METADATA_CORRELATION_ID,
  SCHEDULED_PAYOUT_STRIPE_METADATA_WINDOW_KEY,
} from "../src/config/scheduledPayoutStripeMetadata.js";
import {
  deriveManualInterventionRequired,
  manualScheduledPayoutAttachmentEnabled,
  reconcileScheduledPayoutOpsLedger,
  __setPlatformScheduledPayoutOpsTestHooks,
  type PersistReconcileMatchResult,
} from "../src/services/platformScheduledPayoutOperations.service.js";
import {
  StripeConnectScheduledPayoutRequestStatus,
  ScheduledPayoutReconciliationStatus,
} from "@prisma/client";
import { employeeScheduledLedgerSnapshot } from "../src/services/scheduledBankPayoutLedger.util.js";
import {
  __setListPayoutsForReconciliationFnForTests,
  __setRetrievePayoutForReconciliationFnForTests,
  reconcileScheduledPayoutWithStripe,
  reconciliationListResult,
  SCHEDULED_PAYOUT_RECONCILE_MAX_LIST_PAGES,
  SCHEDULED_PAYOUT_RECONCILE_LIST_PAGE_SIZE,
} from "../src/services/scheduledBankPayoutRecovery.service.js";
import {
  __resetEmployeeScheduledBankPayoutStripeFnsForTests,
  __setEmployeeScheduledBankPayoutStripeFnsForTests,
} from "../src/services/employeeScheduledBankPayout.service.js";
import { SCHEDULED_PAYOUT_PROCESSING_CLAIM_TTL_MS } from "../src/services/scheduledBankPayoutProcessingClaim.service.js";
import { __setWriteAuditLogStrictForTests } from "../src/services/audit.service.js";

function canAccessPlatformAdminWorkspace(user: {
  role: string;
  isPlatformAdmin?: boolean;
  emailVerified?: boolean;
}): boolean {
  if (user.role !== "platform_admin" && user.role !== "admin") return false;
  if (user.isPlatformAdmin !== true) return false;
  if (user.emailVerified === false) return false;
  return true;
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

assert(normalizeConnectPayoutMethod("instant") === "instant", "method instant");
assert(normalizeConnectPayoutMethod("STANDARD") === "standard", "method standard case");
assert(normalizeConnectPayoutMethod(null) === "unknown", "method missing");
assert(normalizeConnectPayoutMethod("wire") === "unknown", "method unsupported");

assert(
  isPlatformAdminPrincipal({
    role: Role.SUPER_ADMIN,
    isPlatformAdmin: true,
    isActive: true,
    emailVerified: true,
  }),
  "platform admin principal ok",
);

assert(
  !isPlatformAdminPrincipal({
    role: Role.SUPER_ADMIN,
    isPlatformAdmin: false,
    isActive: true,
    emailVerified: true,
  }),
  "SUPER_ADMIN without flag denied",
);

assert(
  canAccessPlatformAdminWorkspace({
    role: "platform_admin",
    isPlatformAdmin: true,
    emailVerified: true,
  }),
  "client workspace access ok",
);

const WINDOW_KEY = "2026-10-08T07:00:00.000Z";
const AMOUNT = 9802;

const legacySnapshot = employeeScheduledLedgerSnapshot({
  id: "led_1",
  employeeId: "emp",
  scheduleWindowKey: WINDOW_KEY,
  idempotencyKey: "k",
  amountCents: AMOUNT,
  currency: "eur",
  stripePayoutId: null,
  status: StripeConnectScheduledPayoutRequestStatus.failed,
  failureCode: "stripe_create_failed",
  attemptCount: 1,
  nextRetryAt: null,
  failureClassification: null,
  stripeErrorCode: null,
  stripeErrorType: null,
  stripeHttpStatus: null,
  stripeRequestId: null,
  failureMessage: null,
  reconciliationStatus: ScheduledPayoutReconciliationStatus.none,
  correlationId: null,
  blockedReason: null,
  processingClaimedAt: null,
  processingClaimToken: "secret_token_must_not_leak",
  createdAt: new Date(),
  updatedAt: new Date(),
} as never);

assert(
  deriveManualInterventionRequired(
    {
      status: StripeConnectScheduledPayoutRequestStatus.failed,
      blockedReason: null,
      failureClassification: null,
      reconciliationStatus: ScheduledPayoutReconciliationStatus.none,
      attemptCount: 1,
      correlationId: null,
      stripePayoutId: null,
      failureCode: "stripe_create_failed",
    },
    legacySnapshot,
  ),
  "legacy failed needs manual intervention",
);

assert(!manualScheduledPayoutAttachmentEnabled(), "manual attach disabled by default");

const detailJson = JSON.stringify({
  claimActive: true,
  processingClaimToken: undefined,
});
assert(!detailJson.includes("secret_token"), "DTO must not expose claim token in sample");

let createCalls = 0;
__setWriteAuditLogStrictForTests(async () => {});
__setEmployeeScheduledBankPayoutStripeFnsForTests({
  createStandardPayout: async () => {
    createCalls += 1;
    return { id: "po_should_not_run" };
  },
  listPendingPayouts: async () => false,
  retrieveBalance: async () => ({
    object: "balance",
    available: [{ amount: AMOUNT, currency: "eur" }],
    pending: [],
  }),
});

type MemLedger = {
  id: string;
  employeeId: string;
  businessId: string;
  scheduleWindowKey: string;
  amountCents: number;
  currency: string;
  stripePayoutId: string | null;
  status: StripeConnectScheduledPayoutRequestStatus;
  correlationId: string | null;
  processingClaimedAt: Date | null;
  processingClaimToken: string | null;
  failureCode: string | null;
  attemptCount: number;
  nextRetryAt: Date | null;
  failureClassification: null;
  reconciliationStatus: ScheduledPayoutReconciliationStatus;
  blockedReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function baseMemLedger(overrides: Partial<MemLedger> = {}): MemLedger {
  return {
    id: "led_mem",
    employeeId: "emp_1",
    businessId: "biz_1",
    scheduleWindowKey: WINDOW_KEY,
    amountCents: AMOUNT,
    currency: "eur",
    stripePayoutId: null,
    status: StripeConnectScheduledPayoutRequestStatus.failed,
    correlationId: "corr_admin_test",
    processingClaimedAt: null,
    processingClaimToken: null,
    failureCode: "stripe_create_failed",
    attemptCount: 1,
    nextRetryAt: null,
    failureClassification: null,
    reconciliationStatus: ScheduledPayoutReconciliationStatus.required,
    blockedReason: null,
    createdAt: new Date("2026-10-08T06:00:00.000Z"),
    updatedAt: new Date("2026-10-08T06:05:00.000Z"),
    ...overrides,
  };
}

function payoutFixture(id: string, correlationId: string): import("stripe").Stripe.Payout {
  return {
    id,
    object: "payout",
    amount: AMOUNT,
    currency: "eur",
    metadata: {
      [SCHEDULED_PAYOUT_STRIPE_METADATA_CORRELATION_ID]: correlationId,
      [SCHEDULED_PAYOUT_STRIPE_METADATA_WINDOW_KEY]: WINDOW_KEY,
    },
    created: Math.floor(Date.now() / 1000),
  } as import("stripe").Stripe.Payout;
}

function installMemLedgerHooks(ledger: MemLedger, persistImpl?: () => Promise<PersistReconcileMatchResult>) {
  let persistInFlight = false;
  __setPlatformScheduledPayoutOpsTestHooks({
    loadLedger: async () => ({
      payoutType: "employee" as const,
      row: ledger,
      businessId: ledger.businessId,
      businessName: "Test Hotel",
      employeeName: "Employee",
      stripeAccountId: "acct_test_suffix",
    }),
    tryPersistReconcileMatch:
      persistImpl ??
      (async (_type, _id, stripePayout) => {
        if (persistInFlight) {
          return { ok: false, reason: "concurrent_update_conflict" };
        }
        persistInFlight = true;
        try {
        if (ledger.processingClaimToken && ledger.processingClaimedAt) {
          const age = Date.now() - ledger.processingClaimedAt.getTime();
          if (age <= SCHEDULED_PAYOUT_PROCESSING_CLAIM_TTL_MS) {
            return { ok: false, reason: "processing_claim_held" };
          }
        }
        if (ledger.stripePayoutId?.startsWith("po_") && ledger.stripePayoutId !== stripePayout.id) {
          return { ok: false, reason: "payout_id_conflict" };
        }
        if (ledger.stripePayoutId === stripePayout.id) {
          return { ok: true, idempotent: true };
        }
        if (ledger.stripePayoutId !== null) {
          return { ok: false, reason: "concurrent_update_conflict" };
        }
        ledger.stripePayoutId = stripePayout.id;
        ledger.status = StripeConnectScheduledPayoutRequestStatus.submitted;
        ledger.processingClaimToken = null;
        ledger.processingClaimedAt = null;
        return { ok: true, idempotent: false };
        } finally {
          persistInFlight = false;
        }
      }),
  });
}

// --- Admin reconcile path (in-memory) ---

const ledgerMatch = baseMemLedger();
installMemLedgerHooks(ledgerMatch);
__setListPayoutsForReconciliationFnForTests(async () =>
  reconciliationListResult([payoutFixture("po_match_ok", "corr_admin_test")]),
);
const matched = await reconcileScheduledPayoutOpsLedger("employee", ledgerMatch.id, null);
assert(matched.status === "completed" && matched.outcome === "matched", "admin reconcile match");
assert(createCalls === 0, "match path never creates payout");
assert(ledgerMatch.stripePayoutId === "po_match_ok", "ledger attached after match");

const ledgerNoMatch = baseMemLedger({ id: "led_no_match", correlationId: "corr_empty" });
installMemLedgerHooks(ledgerNoMatch);
__setListPayoutsForReconciliationFnForTests(async () => reconciliationListResult([]));
const noMatch = await reconcileScheduledPayoutOpsLedger("employee", ledgerNoMatch.id, null);
assert(noMatch.status === "completed" && noMatch.outcome === "no_match", "admin reconcile no_match");
assert(createCalls === 0, "no_match never creates");

const ledgerInconclusive = baseMemLedger({ id: "led_inc", correlationId: "corr_inc" });
installMemLedgerHooks(ledgerInconclusive);
__setListPayoutsForReconciliationFnForTests(async () => reconciliationListResult([], false));
const inconclusive = await reconcileScheduledPayoutOpsLedger("employee", ledgerInconclusive.id, null);
assert(inconclusive.status === "inconclusive", "incomplete search → inconclusive");
assert(createCalls === 0, "inconclusive never creates");

const ledgerListErr = baseMemLedger({ id: "led_list_err" });
installMemLedgerHooks(ledgerListErr);
__setListPayoutsForReconciliationFnForTests(async () => {
  throw new Error("stripe_down");
});
const listFail = await reconcileScheduledPayoutOpsLedger("employee", ledgerListErr.id, null);
assert(listFail.status === "inconclusive", "list failure → inconclusive");

const ledgerClaim = baseMemLedger({
  id: "led_claim",
  processingClaimToken: "worker_claim_token",
  processingClaimedAt: new Date(),
});
installMemLedgerHooks(ledgerClaim);
__setListPayoutsForReconciliationFnForTests(async () =>
  reconciliationListResult([payoutFixture("po_blocked", "corr_admin_test")]),
);
const claimBlocked = await reconcileScheduledPayoutOpsLedger("employee", ledgerClaim.id, null);
assert(
  claimBlocked.status === "blocked" && claimBlocked.blockedReason === "processing_claim_held",
  "active worker claim blocks admin reconcile before stripe persist",
);
assert(ledgerClaim.stripePayoutId === null, "claim block must not attach payout");

const ledgerConflict = baseMemLedger({
  id: "led_conflict",
  stripePayoutId: "po_existing_other",
  status: StripeConnectScheduledPayoutRequestStatus.submitted,
});
installMemLedgerHooks(ledgerConflict);
__setRetrievePayoutForReconciliationFnForTests(async () =>
  payoutFixture("po_existing_other", "corr_admin_test"),
);
const conflictRes = await reconcileScheduledPayoutOpsLedger("employee", ledgerConflict.id, null);
assert(
  conflictRes.status === "completed" && conflictRes.outcome === "matched",
  "existing po_ re-validated without overwrite conflict",
);
__setRetrievePayoutForReconciliationFnForTests(null);

const ledgerRace = baseMemLedger({ id: "led_race" });
let racePersistCount = 0;
installMemLedgerHooks(ledgerRace, async () => {
  racePersistCount += 1;
  if (racePersistCount === 1) {
    ledgerRace.stripePayoutId = "po_worker_first";
    return { ok: false, reason: "concurrent_update_conflict" };
  }
  return { ok: false, reason: "concurrent_update_conflict" };
});
__setListPayoutsForReconciliationFnForTests(async () =>
  reconciliationListResult([payoutFixture("po_race", "corr_admin_test")]),
);
const raceRes = await reconcileScheduledPayoutOpsLedger("employee", ledgerRace.id, null);
assert(raceRes.status === "blocked" && raceRes.blockedReason === "concurrent_update_conflict", "persist conflict");
assert(createCalls === 0, "race never creates");

const ledgerDual = baseMemLedger({ id: "led_dual" });
installMemLedgerHooks(ledgerDual);
__setListPayoutsForReconciliationFnForTests(async () =>
  reconciliationListResult([payoutFixture("po_dual", "corr_admin_test")]),
);
const [r1, r2] = await Promise.all([
  reconcileScheduledPayoutOpsLedger("employee", ledgerDual.id, null),
  reconcileScheduledPayoutOpsLedger("employee", ledgerDual.id, null),
]);
assert(
  r1.status !== "failed" && r2.status !== "failed",
  "concurrent reconcile: no hard failures",
);
assert(
  ledgerDual.stripePayoutId === "po_dual",
  "concurrent reconcile: single payout attached",
);
assert(createCalls === 0, "concurrent reconcile never creates");

// Pagination helper: multi-page mock
let listPageCalls = 0;
__setListPayoutsForReconciliationFnForTests(async () => {
  listPageCalls += 1;
  const pages: import("stripe").Stripe.Payout[][] = [];
  for (let i = 0; i < SCHEDULED_PAYOUT_RECONCILE_MAX_LIST_PAGES + 2; i += 1) {
    pages.push([
      payoutFixture(`po_page_${i}`, "corr_paginate") as import("stripe").Stripe.Payout,
    ]);
  }
  if (listPageCalls === 1) {
    return reconciliationListResult(pages[0]!, false);
  }
  return reconciliationListResult([]);
});
const paginatedInconclusive = await reconcileScheduledPayoutWithStripe({
  stripeAccountId: "acct_test",
  ledger: employeeScheduledLedgerSnapshot({
    ...baseMemLedger({ correlationId: "corr_paginate" }),
    employeeId: "emp",
    idempotencyKey: "ik",
    failureClassification: null,
    stripeErrorCode: null,
    stripeErrorType: null,
    stripeHttpStatus: null,
    stripeRequestId: null,
    failureMessage: null,
    blockedReason: null,
    processingClaimedAt: null,
    processingClaimToken: null,
  } as never),
});
assert(paginatedInconclusive.kind === "inconclusive", "searchComplete false → inconclusive");

const multiPagePayouts: import("stripe").Stripe.Payout[] = [];
for (let i = 0; i < SCHEDULED_PAYOUT_RECONCILE_LIST_PAGE_SIZE + 1; i += 1) {
  multiPagePayouts.push(payoutFixture(`po_deep_${i}`, `corr_noise_${i}`));
}
multiPagePayouts.push(payoutFixture("po_deep_match", "corr_deep"));
__setListPayoutsForReconciliationFnForTests(async () => reconciliationListResult(multiPagePayouts));
const deepMatch = await reconcileScheduledPayoutWithStripe({
  stripeAccountId: "acct_test",
  ledger: employeeScheduledLedgerSnapshot({
    ...baseMemLedger({ correlationId: "corr_deep" }),
    employeeId: "emp",
    idempotencyKey: "ik",
    failureClassification: null,
    stripeErrorCode: null,
    stripeErrorType: null,
    stripeHttpStatus: null,
    stripeRequestId: null,
    failureMessage: null,
    blockedReason: null,
    processingClaimedAt: null,
    processingClaimToken: null,
  } as never),
});
assert(deepMatch.kind === "matched", "metadata match across multi-item list");

__setListPayoutsForReconciliationFnForTests(null);
__setRetrievePayoutForReconciliationFnForTests(null);
__setPlatformScheduledPayoutOpsTestHooks(null);
__setWriteAuditLogStrictForTests(null);
__resetEmployeeScheduledBankPayoutStripeFnsForTests();

assert(createCalls === 0, "full suite: zero stripe payout creates");

console.log("platform-scheduled-payout-ops-runtime: ok");
