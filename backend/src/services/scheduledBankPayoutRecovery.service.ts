/**
 * Phase A — shared scheduled bank payout diagnostics, retry, and reconciliation.
 */
import {
  ScheduledPayoutFailureClassification,
  ScheduledPayoutReconciliationStatus,
  StripeConnectScheduledPayoutRequestStatus,
} from "@prisma/client";
import Stripe from "stripe";
import { randomUUID } from "node:crypto";
import {
  SCHEDULED_PAYOUT_STRIPE_METADATA_CORRELATION_ID,
  SCHEDULED_PAYOUT_STRIPE_METADATA_WINDOW_KEY,
} from "../config/scheduledPayoutStripeMetadata.js";
import { logServerError } from "../utils/httpErrors.js";
import { getStripeClient, isStripeConfigured } from "./stripe.service.js";

export type ScheduledBankPayoutRunResult = {
  outcome: "skipped" | "created" | "zero" | "not_due" | "blocked";
  stripePayoutId?: string;
  blockedReason?: string;
};

export const SCHEDULED_PAYOUT_MAX_CREATE_ATTEMPTS = 5;
export const SCHEDULED_PAYOUT_STALE_PENDING_MS = 15 * 60 * 1000;
export const SCHEDULED_PAYOUT_RETRY_BASE_MS = 5 * 60 * 1000;
export const SCHEDULED_PAYOUT_TICK_BATCH_SIZE = 50;
export const SCHEDULED_PAYOUT_TICK_MAX_ACCOUNTS_PER_RUN = 200;

const FAILURE_MESSAGE_MAX = 255;
const SECRET_PATTERN =
  /(?:sk_(?:live|test)_|whsec_|Bearer\s+|postgres(?:ql)?:\/\/|acct_[A-Za-z0-9]{8,})/gi;

export type ScheduledPayoutLedgerSnapshot = {
  id: string;
  status: StripeConnectScheduledPayoutRequestStatus;
  scheduleWindowKey: string;
  idempotencyKey: string;
  amountCents: number;
  currency: string;
  stripePayoutId: string | null;
  failureCode: string | null;
  attemptCount: number;
  nextRetryAt: Date | null;
  failureClassification: ScheduledPayoutFailureClassification | null;
  reconciliationStatus: ScheduledPayoutReconciliationStatus;
  correlationId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type StripePayoutCreateDiagnostics = {
  stripeErrorCode: string | null;
  stripeErrorType: string | null;
  stripeHttpStatus: number | null;
  stripeRequestId: string | null;
  failureMessage: string | null;
  failureClassification: ScheduledPayoutFailureClassification;
  failureCode: string;
};

export type PendingStripePayoutCheck =
  | { kind: "clear" }
  | { kind: "blocked"; blockedReason: "pending_stripe_payout"; maskedPayoutId?: string }
  | { kind: "lookup_failed"; blockedReason: "pending_payout_lookup_failed" };

export type ListPayoutsForReconciliationResult = {
  payouts: Stripe.Payout[];
  /** False when pagination hit a safety cap or could not prove the search completed. */
  searchComplete: boolean;
};

export type ListPayoutsForReconciliationFn = (
  stripeAccountId: string,
  createdGteSec: number,
) => Promise<ListPayoutsForReconciliationResult>;

export const SCHEDULED_PAYOUT_RECONCILE_LIST_PAGE_SIZE = 25;
export const SCHEDULED_PAYOUT_RECONCILE_MAX_LIST_PAGES = 20;

/** Test helper — wrap a payout array as a complete reconciliation list result. */
export function reconciliationListResult(
  payouts: Stripe.Payout[],
  searchComplete = true,
): ListPayoutsForReconciliationResult {
  return { payouts, searchComplete };
}

let listPayoutsForReconciliationFn: ListPayoutsForReconciliationFn | null = null;

export type RetrievePayoutForReconciliationFn = (
  stripeAccountId: string,
  payoutId: string,
) => Promise<Stripe.Payout>;

let retrievePayoutForReconciliationFn: RetrievePayoutForReconciliationFn | null = null;

export function __setListPayoutsForReconciliationFnForTests(
  fn: ListPayoutsForReconciliationFn | null,
): void {
  listPayoutsForReconciliationFn = fn;
}

export function __setRetrievePayoutForReconciliationFnForTests(
  fn: RetrievePayoutForReconciliationFn | null,
): void {
  retrievePayoutForReconciliationFn = fn;
}

export function sanitizeScheduledPayoutFailureMessage(raw: string): string {
  const trimmed = raw.replace(SECRET_PATTERN, "[redacted]").trim();
  if (!trimmed) return "Payout could not be created.";
  return trimmed.length > FAILURE_MESSAGE_MAX ? `${trimmed.slice(0, FAILURE_MESSAGE_MAX - 1)}…` : trimmed;
}

function extractDuckTypedStripeDiagnostics(err: unknown): StripePayoutCreateDiagnostics | null {
  if (!err || typeof err !== "object") return null;
  const record = err as Record<string, unknown>;
  const status = typeof record.statusCode === "number" ? record.statusCode : null;
  const code = typeof record.code === "string" ? record.code : null;
  const type = typeof record.type === "string" ? record.type : null;
  if (status === null && !code && !type) return null;
  const message = sanitizeScheduledPayoutFailureMessage(
    err instanceof Error ? err.message : "Stripe error",
  );
  const failureClassification = classifyStripePayoutError({ code, type, status });
  return {
    stripeErrorCode: code,
    stripeErrorType: type,
    stripeHttpStatus: status,
    stripeRequestId: typeof record.requestId === "string" ? record.requestId : null,
    failureMessage: message,
    failureClassification,
    failureCode: (code ?? type ?? "stripe_create_failed").slice(0, 64),
  };
}

export function extractStripePayoutCreateDiagnostics(err: unknown): StripePayoutCreateDiagnostics {
  if (err instanceof Stripe.errors.StripeError) {
    const code = err.code ?? null;
    const type = err.type ?? null;
    const status = typeof err.statusCode === "number" ? err.statusCode : null;
    const requestId = err.requestId ?? null;
    const failureMessage = sanitizeScheduledPayoutFailureMessage(err.message ?? "Stripe error");
    const failureClassification = classifyStripePayoutError({ code, type, status });
    const failureCode = code ?? type ?? "stripe_create_failed";
    return {
      stripeErrorCode: code,
      stripeErrorType: type,
      stripeHttpStatus: status,
      stripeRequestId: requestId,
      failureMessage,
      failureClassification,
      failureCode: failureCode.slice(0, 64),
    };
  }

  const duck = extractDuckTypedStripeDiagnostics(err);
  if (duck) return duck;

  const message =
    err instanceof Error ? sanitizeScheduledPayoutFailureMessage(err.message) : "Unknown payout error";
  const name = err instanceof Error ? err.name : "";
  const uncertain =
    name === "AbortError" ||
    /timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket hang up/i.test(message);

  return {
    stripeErrorCode: null,
    stripeErrorType: null,
    stripeHttpStatus: null,
    stripeRequestId: null,
    failureMessage: message,
    failureClassification: uncertain
      ? ScheduledPayoutFailureClassification.outcome_uncertain
      : ScheduledPayoutFailureClassification.unknown,
    failureCode: uncertain ? "outcome_uncertain" : "stripe_create_failed",
  };
}

export function classifyStripePayoutError(args: {
  code: string | null;
  type: string | null;
  status: number | null;
}): ScheduledPayoutFailureClassification {
  const code = args.code ?? "";
  if (
    code === "balance_insufficient" ||
    code === "payouts_not_allowed" ||
    code === "account_invalid" ||
    code === "invalid_request_error"
  ) {
    return ScheduledPayoutFailureClassification.permanent;
  }
  if (code === "rate_limit" || args.status === 429) {
    return ScheduledPayoutFailureClassification.retryable;
  }
  if (args.status !== null && args.status >= 500) {
    return ScheduledPayoutFailureClassification.outcome_uncertain;
  }
  if (args.type === "StripeAuthenticationError" || args.type === "StripePermissionError") {
    return ScheduledPayoutFailureClassification.permanent;
  }
  if (args.status !== null && args.status >= 400 && args.status < 500) {
    return ScheduledPayoutFailureClassification.permanent;
  }
  return ScheduledPayoutFailureClassification.unknown;
}

export function computeScheduledPayoutNextRetryAt(attemptCount: number, now = Date.now()): Date {
  const exponent = Math.min(Math.max(attemptCount, 1), 8);
  const baseMs = SCHEDULED_PAYOUT_RETRY_BASE_MS * 2 ** (exponent - 1);
  const jitter = Math.floor(Math.random() * 0.25 * baseMs);
  return new Date(now + baseMs + jitter);
}

export function newScheduledPayoutCorrelationId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 32);
}

export function diagnosticsToLedgerUpdate(
  diagnostics: StripePayoutCreateDiagnostics,
  attemptCount: number,
): {
  status: StripeConnectScheduledPayoutRequestStatus;
  failureCode: string;
  failureClassification: ScheduledPayoutFailureClassification;
  stripeErrorCode: string | null;
  stripeErrorType: string | null;
  stripeHttpStatus: number | null;
  stripeRequestId: string | null;
  failureMessage: string | null;
  attemptCount: number;
  nextRetryAt: Date | null;
  reconciliationStatus: ScheduledPayoutReconciliationStatus;
  blockedReason: string | null;
} {
  const exhausted = attemptCount >= SCHEDULED_PAYOUT_MAX_CREATE_ATTEMPTS;
  const retryable =
    diagnostics.failureClassification === ScheduledPayoutFailureClassification.retryable && !exhausted;
  const uncertain =
    diagnostics.failureClassification === ScheduledPayoutFailureClassification.outcome_uncertain;
  const unknown =
    diagnostics.failureClassification === ScheduledPayoutFailureClassification.unknown;

  let nextRetryAt: Date | null = null;
  let reconciliationStatus: ScheduledPayoutReconciliationStatus =
    ScheduledPayoutReconciliationStatus.none;
  let status = StripeConnectScheduledPayoutRequestStatus.failed;
  let blockedReason: string | null = null;

  if (uncertain || unknown) {
    reconciliationStatus = ScheduledPayoutReconciliationStatus.required;
    blockedReason = "reconciliation_required";
  } else if (retryable) {
    nextRetryAt = computeScheduledPayoutNextRetryAt(attemptCount);
    blockedReason = "retry_scheduled";
  } else if (exhausted && diagnostics.failureClassification === ScheduledPayoutFailureClassification.retryable) {
    blockedReason = "retry_exhausted";
  } else {
    blockedReason = "permanent_failure";
  }

  return {
    status,
    failureCode: diagnostics.failureCode,
    failureClassification: diagnostics.failureClassification,
    stripeErrorCode: diagnostics.stripeErrorCode,
    stripeErrorType: diagnostics.stripeErrorType,
    stripeHttpStatus: diagnostics.stripeHttpStatus,
    stripeRequestId: diagnostics.stripeRequestId,
    failureMessage: diagnostics.failureMessage,
    attemptCount,
    nextRetryAt,
    reconciliationStatus,
    blockedReason,
  };
}

/** Pre–Phase A rows: failed with stripe_create_failed and no failure classification. */
/** Rate-limit only — treated as safe pre-execution retry after reconcile proves no payout exists. */
export function isDefinitePreExecutionRetryableFailure(row: ScheduledPayoutLedgerSnapshot): boolean {
  if (row.failureClassification !== ScheduledPayoutFailureClassification.retryable) return false;
  const code = (row.failureCode ?? "").toLowerCase();
  return code === "rate_limit";
}

export function mayCreateAfterReconcileNoMatch(
  row: ScheduledPayoutLedgerSnapshot,
  now = Date.now(),
): boolean {
  if (row.status !== StripeConnectScheduledPayoutRequestStatus.failed) return false;
  if (!isDefinitePreExecutionRetryableFailure(row)) return false;
  if (row.attemptCount >= SCHEDULED_PAYOUT_MAX_CREATE_ATTEMPTS) return false;
  if (row.nextRetryAt && row.nextRetryAt.getTime() > now) return false;
  return true;
}

export function failedRowRequiresReconciliationBeforeCreate(row: ScheduledPayoutLedgerSnapshot): boolean {
  if (row.status !== StripeConnectScheduledPayoutRequestStatus.failed) return false;
  if (row.stripePayoutId?.startsWith("po_")) return false;
  if (row.failureClassification === ScheduledPayoutFailureClassification.permanent) return false;
  if (row.attemptCount >= SCHEDULED_PAYOUT_MAX_CREATE_ATTEMPTS) return false;
  return row.attemptCount >= 1;
}

export type ResolveScheduledPayoutAmountResult =
  | { ok: true; amountCents: number; currency: string }
  | { ok: false; blockedReason: string };

/** Ledger amount is the authoritative payout request snapshot for a schedule window. */
export function resolveScheduledPayoutCreateAmount(args: {
  ledgerAmountCents: number;
  ledgerCurrency: string;
  ledgerCreated: boolean;
  availableCents: number;
  balanceCurrency: string;
}): ResolveScheduledPayoutAmountResult {
  const ledgerCurrency = args.ledgerCurrency.toLowerCase();
  const balanceCurrency = args.balanceCurrency.toLowerCase();
  if (ledgerCurrency !== balanceCurrency) {
    return { ok: false, blockedReason: "ledger_currency_mismatch" };
  }
  if (args.ledgerAmountCents > 0 && !args.ledgerCreated) {
    if (args.availableCents < args.ledgerAmountCents) {
      return { ok: false, blockedReason: "insufficient_balance_for_ledger_amount" };
    }
    return { ok: true, amountCents: args.ledgerAmountCents, currency: ledgerCurrency };
  }
  if (args.ledgerAmountCents > 0 && args.ledgerCreated) {
    if (args.availableCents < args.ledgerAmountCents) {
      return { ok: false, blockedReason: "insufficient_balance_for_ledger_amount" };
    }
    return { ok: true, amountCents: args.ledgerAmountCents, currency: ledgerCurrency };
  }
  return { ok: true, amountCents: args.availableCents, currency: ledgerCurrency };
}

export function isLegacyFailedWithUnknownOutcome(row: ScheduledPayoutLedgerSnapshot): boolean {
  if (row.status !== StripeConnectScheduledPayoutRequestStatus.failed) return false;
  if (row.stripePayoutId?.startsWith("po_")) return false;
  if (row.failureClassification === ScheduledPayoutFailureClassification.permanent) return false;
  if (row.failureClassification !== null) return false;
  return true;
}

function payoutAmountCurrencyMatchesLedger(payout: Stripe.Payout, ledger: ScheduledPayoutLedgerSnapshot): boolean {
  return (
    payout.amount === ledger.amountCents &&
    String(payout.currency).toLowerCase() === ledger.currency.toLowerCase()
  );
}

export function canAttemptStripeCreateFromLedger(
  row: ScheduledPayoutLedgerSnapshot,
  now = Date.now(),
): { allowed: boolean; reason?: string } {
  if (row.status === StripeConnectScheduledPayoutRequestStatus.submitted && row.stripePayoutId) {
    return { allowed: false, reason: "already_submitted" };
  }
  if (row.status === StripeConnectScheduledPayoutRequestStatus.skipped_zero_balance) {
    return { allowed: false, reason: "skipped_zero" };
  }
  if (row.reconciliationStatus === ScheduledPayoutReconciliationStatus.inconclusive) {
    return { allowed: false, reason: "reconciliation_inconclusive" };
  }
  if (
    row.reconciliationStatus === ScheduledPayoutReconciliationStatus.required &&
    row.status !== StripeConnectScheduledPayoutRequestStatus.pending
  ) {
    return { allowed: false, reason: "reconciliation_required" };
  }
  if (row.status === StripeConnectScheduledPayoutRequestStatus.failed) {
    if (row.failureClassification === ScheduledPayoutFailureClassification.permanent) {
      return { allowed: false, reason: "permanent_failure" };
    }
    if (row.attemptCount >= SCHEDULED_PAYOUT_MAX_CREATE_ATTEMPTS) {
      return { allowed: false, reason: "retry_exhausted" };
    }
    if (failedRowRequiresReconciliationBeforeCreate(row)) {
      return { allowed: false, reason: "reconciliation_required" };
    }
    if (row.failureClassification === ScheduledPayoutFailureClassification.outcome_uncertain) {
      return { allowed: false, reason: "reconciliation_required" };
    }
    if (isLegacyFailedWithUnknownOutcome(row)) {
      return { allowed: false, reason: "reconciliation_required" };
    }
    if (row.failureClassification === ScheduledPayoutFailureClassification.unknown) {
      return { allowed: false, reason: "reconciliation_required" };
    }
    if (row.nextRetryAt && row.nextRetryAt.getTime() > now) {
      return { allowed: false, reason: "retry_not_due" };
    }
    return { allowed: false, reason: "reconciliation_required" };
  }
  if (row.status === StripeConnectScheduledPayoutRequestStatus.pending) {
    const age = now - row.updatedAt.getTime();
    if (age > SCHEDULED_PAYOUT_STALE_PENDING_MS) {
      return { allowed: false, reason: "stale_pending_reconcile" };
    }
    return { allowed: false, reason: "pending_in_flight" };
  }
  return { allowed: true };
}

function maskStripeId(id: string): string {
  const t = id.trim();
  if (t.length <= 10) return "po_…";
  return `${t.slice(0, 6)}…${t.slice(-4)}`;
}

export async function checkPendingStandardStripePayout(
  stripeAccountId: string,
  listPendingFn: (accountId: string) => Promise<boolean>,
): Promise<PendingStripePayoutCheck> {
  try {
    const hasPending = await listPendingFn(stripeAccountId);
    if (!hasPending) return { kind: "clear" };
    if (isStripeConfigured()) {
      try {
        const page = await getStripeClient().payouts.list(
          { status: "pending", limit: 1 },
          { stripeAccount: stripeAccountId },
        );
        const po = page.data[0];
        return {
          kind: "blocked",
          blockedReason: "pending_stripe_payout",
          maskedPayoutId: po?.id ? maskStripeId(po.id) : undefined,
        };
      } catch (err) {
        logServerError("scheduledBankPayoutRecovery.pendingListDetail", err, {
          accountSuffix: stripeAccountId.slice(-6),
        });
      }
    }
    return { kind: "blocked", blockedReason: "pending_stripe_payout" };
  } catch (err) {
    logServerError("scheduledBankPayoutRecovery.pendingCheck", err, {
      accountSuffix: stripeAccountId.slice(-6),
    });
    return { kind: "lookup_failed", blockedReason: "pending_payout_lookup_failed" };
  }
}

async function defaultListPayouts(
  stripeAccountId: string,
  createdGteSec: number,
): Promise<ListPayoutsForReconciliationResult> {
  if (!isStripeConfigured()) {
    return { payouts: [], searchComplete: true };
  }
  const payouts: Stripe.Payout[] = [];
  let startingAfter: string | undefined;
  for (let pageIndex = 0; pageIndex < SCHEDULED_PAYOUT_RECONCILE_MAX_LIST_PAGES; pageIndex += 1) {
    const page = await getStripeClient().payouts.list(
      {
        limit: SCHEDULED_PAYOUT_RECONCILE_LIST_PAGE_SIZE,
        created: { gte: createdGteSec },
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      },
      { stripeAccount: stripeAccountId },
    );
    const batch = page.data ?? [];
    payouts.push(...batch);
    if (!page.has_more) {
      return { payouts, searchComplete: true };
    }
    const lastId = batch[batch.length - 1]?.id;
    if (!lastId) {
      return { payouts, searchComplete: false };
    }
    startingAfter = lastId;
  }
  return { payouts, searchComplete: false };
}

/**
 * Best-effort reconciliation when outcome is uncertain or pending ledger is stale.
 * Does not create payouts — only searches existing Stripe payout objects.
 */
export async function reconcileScheduledPayoutWithStripe(args: {
  stripeAccountId: string;
  ledger: ScheduledPayoutLedgerSnapshot;
}): Promise<
  | { kind: "matched"; stripePayoutId: string; stripePayout: Stripe.Payout }
  | { kind: "no_match" }
  | { kind: "inconclusive" }
> {
  const { stripeAccountId, ledger } = args;
  if (ledger.stripePayoutId?.startsWith("po_")) {
    try {
      const retrieveFn = retrievePayoutForReconciliationFn;
      const po =
        retrieveFn !== null
          ? await retrieveFn(stripeAccountId, ledger.stripePayoutId)
          : !isStripeConfigured()
            ? null
            : await getStripeClient().payouts.retrieve(ledger.stripePayoutId, {
                stripeAccount: stripeAccountId,
              });
      if (!po) return { kind: "inconclusive" };
      if (!payoutAmountCurrencyMatchesLedger(po, ledger)) {
        return { kind: "inconclusive" };
      }
      return { kind: "matched", stripePayoutId: po.id, stripePayout: po };
    } catch (err) {
      logServerError("scheduledBankPayoutRecovery.retrieveKnownPayout", err, {
        ledgerId: ledger.id,
      });
      return { kind: "inconclusive" };
    }
  }

  const correlationId = ledger.correlationId?.trim();
  if (!correlationId) {
    return { kind: "inconclusive" };
  }

  const listFn = listPayoutsForReconciliationFn ?? defaultListPayouts;
  const createdGteSec = Math.floor(ledger.createdAt.getTime() / 1000) - 120;
  let payouts: Stripe.Payout[] = [];
  try {
    const listed = await listFn(stripeAccountId, createdGteSec);
    payouts = listed.payouts;
    if (!listed.searchComplete) {
      return { kind: "inconclusive" };
    }
  } catch (err) {
    logServerError("scheduledBankPayoutRecovery.listForReconcile", err, { ledgerId: ledger.id });
    return { kind: "inconclusive" };
  }

  const metadataMatches = payouts.filter((p) => {
    if (!payoutAmountCurrencyMatchesLedger(p, ledger)) return false;
    const meta = p.metadata ?? {};
    return (
      meta[SCHEDULED_PAYOUT_STRIPE_METADATA_CORRELATION_ID] === correlationId &&
      meta[SCHEDULED_PAYOUT_STRIPE_METADATA_WINDOW_KEY] === ledger.scheduleWindowKey
    );
  });
  if (metadataMatches.length === 1) {
    const po = metadataMatches[0]!;
    return { kind: "matched", stripePayoutId: po.id, stripePayout: po };
  }
  if (metadataMatches.length > 1) {
    return { kind: "inconclusive" };
  }

  const amountOnlyCandidates = payouts.filter((p) => payoutAmountCurrencyMatchesLedger(p, ledger));
  if (amountOnlyCandidates.length > 0) {
    return { kind: "inconclusive" };
  }
  return { kind: "no_match" };
}

export type LedgerGateResult =
  | { action: "proceed" }
  | { action: "block"; blockedReason: string }
  | { action: "wait_retry"; blockedReason: string }
  | { action: "reconciled"; stripePayoutId: string; stripePayout: Stripe.Payout };

export async function gateScheduledLedgerBeforeCreate(args: {
  stripeAccountId: string;
  ledger: ScheduledPayoutLedgerSnapshot;
  ledgerCreated: boolean;
  listPendingFn: (accountId: string) => Promise<boolean>;
}): Promise<LedgerGateResult> {
  const { ledger, ledgerCreated, stripeAccountId, listPendingFn } = args;

  if (ledgerCreated && ledger.status === StripeConnectScheduledPayoutRequestStatus.pending) {
    return { action: "proceed" };
  }

  const attempt = canAttemptStripeCreateFromLedger(ledger);

  if (attempt.reason === "stale_pending_reconcile" || attempt.reason === "reconciliation_required") {
    const recon = await reconcileScheduledPayoutWithStripe({ stripeAccountId, ledger });
    if (recon.kind === "matched") {
      return {
        action: "reconciled",
        stripePayoutId: recon.stripePayoutId,
        stripePayout: recon.stripePayout,
      };
    }
    if (recon.kind === "inconclusive") {
      return { action: "block", blockedReason: "reconciliation_inconclusive" };
    }
    if (ledger.status === StripeConnectScheduledPayoutRequestStatus.pending) {
      return { action: "block", blockedReason: "stale_pending_no_stripe_match" };
    }
    if (mayCreateAfterReconcileNoMatch(ledger)) {
      return { action: "proceed" };
    }
    return { action: "block", blockedReason: "reconciliation_no_match" };
  }

  if (!attempt.allowed) {
    if (attempt.reason === "retry_not_due") {
      return { action: "wait_retry", blockedReason: attempt.reason };
    }
    return { action: "block", blockedReason: attempt.reason ?? "blocked" };
  }

  if (!ledgerCreated && ledger.status === StripeConnectScheduledPayoutRequestStatus.pending) {
    const age = Date.now() - ledger.updatedAt.getTime();
    if (age <= SCHEDULED_PAYOUT_STALE_PENDING_MS) {
      return { action: "block", blockedReason: "pending_in_flight" };
    }
    const recon = await reconcileScheduledPayoutWithStripe({ stripeAccountId, ledger });
    if (recon.kind === "matched") {
      return {
        action: "reconciled",
        stripePayoutId: recon.stripePayoutId,
        stripePayout: recon.stripePayout,
      };
    }
    if (recon.kind === "inconclusive") {
      return { action: "block", blockedReason: "reconciliation_inconclusive" };
    }
    return { action: "block", blockedReason: "stale_pending_no_stripe_match" };
  }

  return { action: "proceed" };
}

export function logScheduledPayoutCreateFailure(
  context: "employeeScheduledBankPayout.create" | "businessScheduledBankPayout.create",
  err: unknown,
  meta: Record<string, unknown>,
  diagnostics: StripePayoutCreateDiagnostics,
): void {
  logServerError(context, err, {
    ...meta,
    failureClassification: diagnostics.failureClassification,
    stripeErrorCode: diagnostics.stripeErrorCode,
    stripeErrorType: diagnostics.stripeErrorType,
    stripeHttpStatus: diagnostics.stripeHttpStatus,
    stripeRequestId: diagnostics.stripeRequestId,
  });
}
