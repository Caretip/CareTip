/**
 * CareTip-initiated standard bank payouts for every_3_days preference only.
 * Uses Stripe Balance available funds (not pending). Idempotent per schedule window.
 */
import {
  BusinessBankPayoutSchedule,
  type StripeConnectScheduledPayoutRequest,
  ScheduledPayoutReconciliationStatus,
  StripeConnectScheduledPayoutRequestStatus,
} from "@prisma/client";
import type Stripe from "stripe";
import { prisma } from "../prisma.js";
import { runSerializedByKey } from "../utils/serializedByKey.js";
import { logServerError } from "../utils/httpErrors.js";
import { isPrismaUniqueViolation } from "../utils/prismaErrors.js";
import { getStripeClient, isStripeConfigured } from "./stripe.service.js";
import {
  computeNextEvery3DaysPayoutAt,
  scheduleWindowKeyFromDate,
} from "./businessBankPayoutSchedule.service.js";
import {
  ingestStripePayoutObjectForBusiness,
  invalidateConnectPayoutListSyncThrottle,
} from "./stripeConnectPayout.service.js";
import {
  SCHEDULED_PAYOUT_TICK_BATCH_SIZE,
  SCHEDULED_PAYOUT_TICK_MAX_ACCOUNTS_PER_RUN,
  checkPendingStandardStripePayout,
  diagnosticsToLedgerUpdate,
  extractStripePayoutCreateDiagnostics,
  gateScheduledLedgerBeforeCreate,
  logScheduledPayoutCreateFailure,
  newScheduledPayoutCorrelationId,
  resolveScheduledPayoutCreateAmount,
} from "./scheduledBankPayoutRecovery.service.js";
import { buildScheduledPayoutStripeMetadata } from "../config/scheduledPayoutStripeMetadata.js";
import { businessScheduledLedgerSnapshot } from "./scheduledBankPayoutLedger.util.js";
import {
  persistBusinessScheduledPayoutLedgerIfClaimOwner,
  runWithBusinessScheduledPayoutClaimHeartbeat,
} from "./scheduledBankPayoutProcessingClaim.service.js";
import { validateScheduledStandardPayoutDestination } from "./scheduledBankPayoutDestination.service.js";
import type { ScheduledBankPayoutRunResult } from "./scheduledBankPayoutRecovery.service.js";

const EUR_STANDARD_MIN_CENTS = 100;

type CreateStandardPayoutFn = (args: {
  stripeAccountId: string;
  amountCents: number;
  currency: string;
  idempotencyKey: string;
  correlationId: string;
  scheduleWindowKey: string;
}) => Promise<Stripe.Payout>;

type RetrieveBalanceFn = (stripeAccountId: string) => Promise<Stripe.Balance>;
type ListPendingPayoutsFn = (stripeAccountId: string) => Promise<boolean>;

let createStandardPayoutFn: CreateStandardPayoutFn | null = null;
let retrieveBalanceFn: RetrieveBalanceFn | null = null;
let listPendingPayoutsFn: ListPendingPayoutsFn | null = null;

export function __setScheduledBankPayoutStripeFnsForTests(fns: {
  createStandardPayout?: CreateStandardPayoutFn | null;
  retrieveBalance?: RetrieveBalanceFn | null;
  listPendingPayouts?: ListPendingPayoutsFn | null;
}): void {
  createStandardPayoutFn = fns.createStandardPayout === undefined ? createStandardPayoutFn : fns.createStandardPayout;
  retrieveBalanceFn = fns.retrieveBalance === undefined ? retrieveBalanceFn : fns.retrieveBalance;
  listPendingPayoutsFn = fns.listPendingPayouts === undefined ? listPendingPayoutsFn : fns.listPendingPayouts;
}

export function __resetScheduledBankPayoutStripeFnsForTests(): void {
  createStandardPayoutFn = null;
  retrieveBalanceFn = null;
  listPendingPayoutsFn = null;
}

function balanceAvailableCents(balance: Stripe.Balance, currency: string): number {
  const row = (balance.available ?? []).find((e) => String(e.currency).toLowerCase() === currency);
  return typeof row?.amount === "number" && Number.isInteger(row.amount) ? row.amount : 0;
}

function primaryCurrency(balance: Stripe.Balance): string {
  const rows = [...(balance.available ?? []), ...(balance.pending ?? [])];
  const eur = rows.find((r) => String(r.currency).toLowerCase() === "eur");
  return String((eur ?? rows[0])?.currency ?? "eur").toLowerCase().slice(0, 8);
}

async function retrieveBalance(stripeAccountId: string): Promise<Stripe.Balance> {
  if (retrieveBalanceFn) return retrieveBalanceFn(stripeAccountId);
  return getStripeClient().balance.retrieve({}, { stripeAccount: stripeAccountId });
}

async function hasPendingStandardPayout(stripeAccountId: string): Promise<boolean> {
  if (listPendingPayoutsFn) return listPendingPayoutsFn(stripeAccountId);
  const page = await getStripeClient().payouts.list(
    { status: "pending", limit: 1 },
    { stripeAccount: stripeAccountId },
  );
  return page.data.length > 0;
}

async function createStandardPayout(args: {
  stripeAccountId: string;
  amountCents: number;
  currency: string;
  idempotencyKey: string;
  correlationId: string;
  scheduleWindowKey: string;
}): Promise<Stripe.Payout> {
  if (createStandardPayoutFn) return createStandardPayoutFn(args);
  return getStripeClient().payouts.create(
    {
      amount: args.amountCents,
      currency: args.currency,
      metadata: buildScheduledPayoutStripeMetadata({
        correlationId: args.correlationId,
        scheduleWindowKey: args.scheduleWindowKey,
      }),
    },
    { stripeAccount: args.stripeAccountId, idempotencyKey: args.idempotencyKey },
  );
}

export function scheduledBankPayoutStripeIdempotencyKey(businessId: string, dueAt: Date): string {
  const windowKey = scheduleWindowKeyFromDate(dueAt);
  return `caretip_scheduled_payout:${businessId}:${windowKey}`;
}

type ScheduledPayoutLedgerCreate = {
  businessId: string;
  scheduleWindowKey: string;
  idempotencyKey: string;
  amountCents: number;
  currency: string;
  status: StripeConnectScheduledPayoutRequestStatus;
};

async function findScheduledPayoutLedgerRow(
  businessId: string,
  scheduleWindowKey: string,
): Promise<StripeConnectScheduledPayoutRequest | null> {
  return prisma.stripeConnectScheduledPayoutRequest.findUnique({
    where: { businessId_scheduleWindowKey: { businessId, scheduleWindowKey } },
  });
}

/** Insert ledger row or load the winner's row after a concurrent P2002 (multi-instance cron). */
export async function __createScheduledPayoutLedgerRowOrGetExistingForTests(
  data: ScheduledPayoutLedgerCreate,
): Promise<{ row: StripeConnectScheduledPayoutRequest; created: boolean }> {
  return createScheduledPayoutLedgerRowOrGetExisting(data);
}

async function createScheduledPayoutLedgerRowOrGetExisting(
  data: ScheduledPayoutLedgerCreate,
): Promise<{ row: StripeConnectScheduledPayoutRequest; created: boolean }> {
  const existing = await findScheduledPayoutLedgerRow(data.businessId, data.scheduleWindowKey);
  if (existing) return { row: existing, created: false };
  try {
    const row = await prisma.stripeConnectScheduledPayoutRequest.create({ data });
    return { row, created: true };
  } catch (err) {
    if (!isPrismaUniqueViolation(err)) throw err;
    for (let attempt = 0; attempt < 4; attempt++) {
      const raced =
        (await findScheduledPayoutLedgerRow(data.businessId, data.scheduleWindowKey)) ??
        (await prisma.stripeConnectScheduledPayoutRequest.findUnique({
          where: { idempotencyKey: data.idempotencyKey },
        }));
      if (raced) return { row: raced, created: false };
      await new Promise((resolve) => setTimeout(resolve, 15 * (attempt + 1)));
    }
    throw err;
  }
}

async function advanceEvery3DaysWindow(businessId: string, previousAnchorUtc: Date): Promise<void> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { timezone: true },
  });
  if (!business) return;
  const next = computeNextEvery3DaysPayoutAt({
    timezone: business.timezone,
    previousAnchorUtc,
  });
  await prisma.business.update({
    where: { id: businessId },
    data: { bankPayoutNextScheduledAt: next },
  });
}

export async function runScheduledBankPayoutForBusiness(
  businessId: string,
): Promise<ScheduledBankPayoutRunResult> {
  if (!isStripeConfigured() && !createStandardPayoutFn) {
    return { outcome: "skipped" };
  }

  return runSerializedByKey(`scheduled-bank-payout:${businessId}`, async () => {
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: {
        id: true,
        bankPayoutSchedule: true,
        bankPayoutNextScheduledAt: true,
        stripeAccountId: true,
        stripePayoutsEnabled: true,
        deletedAt: true,
        legalHold: true,
        timezone: true,
      },
    });
    if (!business) return { outcome: "skipped" };
    if (business.bankPayoutSchedule !== BusinessBankPayoutSchedule.every_3_days) {
      return { outcome: "skipped" };
    }
    if (business.deletedAt || business.legalHold) return { outcome: "blocked" };
    const stripeAccountId = business.stripeAccountId?.trim();
    if (!stripeAccountId || !business.stripePayoutsEnabled) return { outcome: "blocked" };

    const dueAt = business.bankPayoutNextScheduledAt;
    if (!dueAt || dueAt.getTime() > Date.now()) return { outcome: "not_due" };

    const windowKey = scheduleWindowKeyFromDate(dueAt);
    const idempotencyKey = scheduledBankPayoutStripeIdempotencyKey(businessId, dueAt);

    const existing = await findScheduledPayoutLedgerRow(businessId, windowKey);
    if (existing?.status === StripeConnectScheduledPayoutRequestStatus.submitted && existing.stripePayoutId) {
      await advanceEvery3DaysWindow(businessId, dueAt);
      return { outcome: "created", stripePayoutId: existing.stripePayoutId };
    }
    if (existing?.status === StripeConnectScheduledPayoutRequestStatus.skipped_zero_balance) {
      await advanceEvery3DaysWindow(businessId, dueAt);
      return { outcome: "zero" };
    }

    const pendingCheck = await checkPendingStandardStripePayout(stripeAccountId, hasPendingStandardPayout);
    if (pendingCheck.kind === "blocked") {
      return { outcome: "blocked", blockedReason: pendingCheck.blockedReason };
    }
    if (pendingCheck.kind === "lookup_failed") {
      return { outcome: "blocked", blockedReason: pendingCheck.blockedReason };
    }

    const balance = await retrieveBalance(stripeAccountId);
    const currency = primaryCurrency(balance);
    const availableCents = balanceAvailableCents(balance, currency);

    if (availableCents < EUR_STANDARD_MIN_CENTS) {
      const { row } = await createScheduledPayoutLedgerRowOrGetExisting({
        businessId,
        scheduleWindowKey: windowKey,
        idempotencyKey,
        amountCents: 0,
        currency,
        status: StripeConnectScheduledPayoutRequestStatus.skipped_zero_balance,
      });
      if (row.status !== StripeConnectScheduledPayoutRequestStatus.skipped_zero_balance) {
        await prisma.stripeConnectScheduledPayoutRequest.update({
          where: { id: row.id },
          data: { status: StripeConnectScheduledPayoutRequestStatus.skipped_zero_balance },
        });
      }
      await advanceEvery3DaysWindow(businessId, dueAt);
      return { outcome: "zero" };
    }

    const { row: request, created: ledgerCreated } = await createScheduledPayoutLedgerRowOrGetExisting({
      businessId,
      scheduleWindowKey: windowKey,
      idempotencyKey,
      amountCents: availableCents,
      currency,
      status: StripeConnectScheduledPayoutRequestStatus.pending,
    });

    if (
      request.status === StripeConnectScheduledPayoutRequestStatus.submitted &&
      request.stripePayoutId
    ) {
      await advanceEvery3DaysWindow(businessId, dueAt);
      return { outcome: "created", stripePayoutId: request.stripePayoutId };
    }
    if (request.status === StripeConnectScheduledPayoutRequestStatus.skipped_zero_balance) {
      await advanceEvery3DaysWindow(businessId, dueAt);
      return { outcome: "zero" };
    }
    const gate = await gateScheduledLedgerBeforeCreate({
      stripeAccountId,
      ledger: businessScheduledLedgerSnapshot(request),
      ledgerCreated,
      listPendingFn: hasPendingStandardPayout,
    });
    if (gate.action === "reconciled") {
      await prisma.stripeConnectScheduledPayoutRequest.update({
        where: { id: request.id },
        data: {
          status: StripeConnectScheduledPayoutRequestStatus.submitted,
          stripePayoutId: gate.stripePayoutId,
          reconciliationStatus: ScheduledPayoutReconciliationStatus.resolved,
          blockedReason: null,
        },
      });
      await ingestStripePayoutObjectForBusiness({
        businessId,
        stripeAccountId,
        payout: gate.stripePayout,
        eventType: "payout.scheduled_reconcile",
        eventId: `scheduled_reconcile:${idempotencyKey}`,
      });
      invalidateConnectPayoutListSyncThrottle(businessId);
      await advanceEvery3DaysWindow(businessId, dueAt);
      return { outcome: "created", stripePayoutId: gate.stripePayoutId };
    }
    if (gate.action === "block" || gate.action === "wait_retry") {
      return { outcome: "blocked", blockedReason: gate.blockedReason };
    }

    const amountResolved = resolveScheduledPayoutCreateAmount({
      ledgerAmountCents: request.amountCents,
      ledgerCurrency: request.currency,
      ledgerCreated,
      availableCents,
      balanceCurrency: currency,
    });
    if (!amountResolved.ok) {
      return { outcome: "blocked", blockedReason: amountResolved.blockedReason };
    }
    const payoutAmountCents = amountResolved.amountCents;

    const correlationId = request.correlationId ?? newScheduledPayoutCorrelationId();
    const claimRun = await runWithBusinessScheduledPayoutClaimHeartbeat(
      request.id,
      correlationId,
      async (handle) => {
        if (!(await handle.renew())) {
          return { kind: "claim_lost" as const };
        }
        const nextAttemptCount = request.attemptCount + 1;
        try {
          const destinationCheck = await validateScheduledStandardPayoutDestination({
            stripeAccountId,
            currency: amountResolved.currency,
          });
          if (!destinationCheck.ok) {
            const diagnostics = destinationCheck.diagnostics;
            logScheduledPayoutCreateFailure(
              "businessScheduledBankPayout.create",
              new Error(diagnostics.failureMessage ?? "Payout destination blocked"),
              {
                businessId,
                windowKey,
                idempotencyKey,
                correlationId,
                destinationBlocked: true,
                failureCode: diagnostics.failureCode,
              },
              diagnostics,
            );
            const ledgerUpdate = diagnosticsToLedgerUpdate(diagnostics, nextAttemptCount);
            await persistBusinessScheduledPayoutLedgerIfClaimOwner({
              ledgerId: request.id,
              claimToken: handle.claimToken,
              data: {
                ...ledgerUpdate,
                correlationId,
                processingClaimedAt: null,
                processingClaimToken: null,
              },
            });
            return {
              kind: "stripe_failed" as const,
              blockedReason: ledgerUpdate.blockedReason ?? "permanent_failure",
            };
          }
          const stripePayout = await createStandardPayout({
            stripeAccountId,
            amountCents: payoutAmountCents,
            currency: amountResolved.currency,
            idempotencyKey,
            correlationId,
            scheduleWindowKey: windowKey,
          });
          if (!(await handle.renew())) {
            return { kind: "claim_lost_after_stripe" as const, stripePayoutId: stripePayout.id };
          }
          const submitted = await persistBusinessScheduledPayoutLedgerIfClaimOwner({
            ledgerId: request.id,
            claimToken: handle.claimToken,
            data: {
              status: StripeConnectScheduledPayoutRequestStatus.submitted,
              stripePayoutId: stripePayout.id,
              amountCents: payoutAmountCents,
              reconciliationStatus: ScheduledPayoutReconciliationStatus.resolved,
              processingClaimedAt: null,
              processingClaimToken: null,
              blockedReason: null,
              failureClassification: null,
              nextRetryAt: null,
            },
          });
          if (!submitted) {
            return { kind: "claim_lost_after_stripe" as const, stripePayoutId: stripePayout.id };
          }
          return { kind: "created" as const, stripePayout };
        } catch (err) {
          const diagnostics = extractStripePayoutCreateDiagnostics(err);
          logScheduledPayoutCreateFailure("businessScheduledBankPayout.create", err, {
            businessId,
            windowKey,
            idempotencyKey,
            correlationId,
          }, diagnostics);
          const ledgerUpdate = diagnosticsToLedgerUpdate(diagnostics, nextAttemptCount);
          await persistBusinessScheduledPayoutLedgerIfClaimOwner({
            ledgerId: request.id,
            claimToken: handle.claimToken,
            data: {
              ...ledgerUpdate,
              correlationId,
              processingClaimedAt: null,
              processingClaimToken: null,
            },
          });
          return {
            kind: "stripe_failed" as const,
            blockedReason: ledgerUpdate.blockedReason ?? "stripe_create_failed",
          };
        }
      },
    );

    if (claimRun.kind === "not_acquired") {
      return { outcome: "blocked", blockedReason: "processing_claim_held" };
    }
    if (claimRun.kind === "heartbeat_lost") {
      return { outcome: "blocked", blockedReason: "processing_claim_heartbeat_lost" };
    }
    const inner = claimRun.value;
    if (inner.kind === "claim_lost") {
      return { outcome: "blocked", blockedReason: "processing_claim_heartbeat_lost" };
    }
    if (inner.kind === "stripe_failed") {
      return { outcome: "blocked", blockedReason: inner.blockedReason };
    }
    if (inner.kind === "claim_lost_after_stripe") {
      await prisma.stripeConnectScheduledPayoutRequest.updateMany({
        where: { id: request.id, stripePayoutId: null },
        data: {
          stripePayoutId: inner.stripePayoutId,
          reconciliationStatus: ScheduledPayoutReconciliationStatus.required,
          blockedReason: "reconciliation_required",
        },
      });
      return { outcome: "blocked", blockedReason: "reconciliation_required" };
    }
    const stripePayout = inner.stripePayout;

    try {
      await ingestStripePayoutObjectForBusiness({
        businessId,
        stripeAccountId,
        payout: stripePayout,
        eventType: "payout.scheduled_create",
        eventId: `scheduled:${idempotencyKey}`,
      });
      invalidateConnectPayoutListSyncThrottle(businessId);
    } catch (observeErr) {
      logServerError("businessScheduledBankPayout.observePayout", observeErr, {
        businessId,
        stripePayoutId: stripePayout.id,
      });
    }
    await advanceEvery3DaysWindow(businessId, dueAt);
    return { outcome: "created", stripePayoutId: stripePayout.id };
  });
}

/** Ops recovery for a specific ledger — only when it matches the business current due window. */
export async function runScheduledBankPayoutRecoveryForBusinessLedger(
  ledgerId: string,
): Promise<import("./scheduledBankPayoutRecovery.service.js").ScheduledBankPayoutRunResult> {
  const request = await prisma.stripeConnectScheduledPayoutRequest.findUnique({
    where: { id: ledgerId },
  });
  if (!request) return { outcome: "blocked", blockedReason: "ledger_not_found" };
  if (
    request.status === StripeConnectScheduledPayoutRequestStatus.submitted &&
    request.stripePayoutId?.startsWith("po_")
  ) {
    return { outcome: "blocked", blockedReason: "already_submitted" };
  }
  const business = await prisma.business.findUnique({
    where: { id: request.businessId },
    select: { bankPayoutNextScheduledAt: true },
  });
  const dueAt = business?.bankPayoutNextScheduledAt;
  if (!dueAt) return { outcome: "blocked", blockedReason: "no_scheduled_due" };
  const windowKey = scheduleWindowKeyFromDate(dueAt);
  if (windowKey !== request.scheduleWindowKey) {
    return { outcome: "blocked", blockedReason: "ledger_window_not_current" };
  }
  return runScheduledBankPayoutForBusiness(request.businessId);
}

export async function tickBusinessScheduledBankPayouts(): Promise<
  import("./employeeScheduledBankPayout.service.js").ScheduledBankPayoutTickCounts
> {
  const now = new Date();
  const { countDueBusinessScheduledBankPayoutAccounts } = await import(
    "./scheduledBankPayoutDueBacklog.service.js"
  );
  const {
    fetchDueBusinessScheduledBankPayoutBatch,
    runFairScheduledBankPayoutStreamTick,
  } = await import("./scheduledBankPayoutDueSelection.service.js");
  const dueBacklogBefore = await countDueBusinessScheduledBankPayoutAccounts(now);

  const fair = await runFairScheduledBankPayoutStreamTick({
    stream: "business",
    now,
    fetchBatch: (after, limit) => fetchDueBusinessScheduledBankPayoutBatch({ now, after, limit }),
    processAccount: (businessId) => runScheduledBankPayoutForBusiness(businessId),
    onProcessError: (businessId, err) => {
      logServerError("businessScheduledBankPayout.tick.business", err, { businessId });
    },
  });

  const dueBacklogAfter = await countDueBusinessScheduledBankPayoutAccounts(new Date());
  return {
    scanned: fair.scanned,
    processed: fair.processed,
    created: fair.created,
    zero: fair.zero,
    blocked: fair.blocked,
    notDue: fair.notDue,
    skipped: fair.skipped,
    retryScheduled: fair.retryScheduled,
    blockedReasons: fair.blockedReasons,
    capReached: fair.capReached,
    dueBacklogBefore,
    dueBacklogAfter,
    fairnessWraps: fair.fairnessWraps,
    cursorSave: fair.cursorSave,
  };
}

export async function tickScheduledBankPayouts(): Promise<{
  scanned: number;
  created: number;
  zero: number;
  blocked: number;
  notDue: number;
  business: Awaited<ReturnType<typeof tickBusinessScheduledBankPayouts>>;
  employee: import("./employeeScheduledBankPayout.service.js").ScheduledBankPayoutTickCounts;
  observability: import("./scheduledBankPayoutTickObservability.service.js").ScheduledPayoutTickObservabilitySummary;
}> {
  const startedAtMs = Date.now();
  const {
    buildStreamTickMetrics,
    finalizeScheduledPayoutTickObservability,
    safeFinalizeScheduledPayoutTickOnError,
  } = await import("./scheduledBankPayoutTickObservability.service.js");
  const { tickEmployeeScheduledBankPayouts } = await import("./employeeScheduledBankPayout.service.js");

  const streamMetrics: import("./scheduledBankPayoutTickObservability.service.js").ScheduledPayoutTickStreamMetrics[] =
    [];

  let tickError: unknown = null;
  let business!: Awaited<ReturnType<typeof tickBusinessScheduledBankPayouts>>;
  let employee!: import("./employeeScheduledBankPayout.service.js").ScheduledBankPayoutTickCounts;
  let observability!: import("./scheduledBankPayoutTickObservability.service.js").ScheduledPayoutTickObservabilitySummary;

  try {
    const businessStarted = Date.now();
    business = await tickBusinessScheduledBankPayouts();
    streamMetrics.push(
      buildStreamTickMetrics({
        stream: "business",
        durationMs: Date.now() - businessStarted,
        counts: business,
        dueBacklogBefore: business.dueBacklogBefore,
        dueBacklogAfter: business.dueBacklogAfter,
      }),
    );

    const employeeStarted = Date.now();
    employee = await tickEmployeeScheduledBankPayouts();
    streamMetrics.push(
      buildStreamTickMetrics({
        stream: "employee",
        durationMs: Date.now() - employeeStarted,
        counts: employee,
        dueBacklogBefore: employee.dueBacklogBefore,
        dueBacklogAfter: employee.dueBacklogAfter,
      }),
    );

    observability = finalizeScheduledPayoutTickObservability({
      startedAtMs,
      success: true,
      errorClass: null,
      streams: streamMetrics,
    });
  } catch (err) {
    tickError = err;
    safeFinalizeScheduledPayoutTickOnError(startedAtMs, err, streamMetrics);
  } finally {
    const { scheduleScheduledPayoutIncidentSyncAfterPayoutTickAttempt } = await import(
      "./scheduledBankPayoutIncident.service.js"
    );
    scheduleScheduledPayoutIncidentSyncAfterPayoutTickAttempt(tickError != null);
  }

  if (tickError) throw tickError;

  return {
    scanned: business.scanned + employee.scanned,
    created: business.created + employee.created,
    zero: business.zero + employee.zero,
    blocked: business.blocked + employee.blocked,
    notDue: business.notDue + employee.notDue,
    business,
    employee,
    observability,
  };
}
