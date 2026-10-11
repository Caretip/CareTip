/**
 * CareTip-initiated standard bank payouts for employee every_3_days preference.
 * Operates on the employee Stripe Connect balance (after CareTip transfers), not tip release.
 */
import {
  BusinessBankPayoutSchedule,
  type EmployeeStripeScheduledPayoutRequest,
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
import { persistEmployeePayoutFromStripeObject } from "./employeeStripePayout.service.js";
import {
  checkPendingStandardStripePayout,
  diagnosticsToLedgerUpdate,
  extractStripePayoutCreateDiagnostics,
  gateScheduledLedgerBeforeCreate,
  logScheduledPayoutCreateFailure,
  newScheduledPayoutCorrelationId,
  resolveScheduledPayoutCreateAmount,
  type ScheduledBankPayoutRunResult,
} from "./scheduledBankPayoutRecovery.service.js";

export type { ScheduledBankPayoutRunResult };
import { buildScheduledPayoutStripeMetadata } from "../config/scheduledPayoutStripeMetadata.js";
import { employeeScheduledLedgerSnapshot } from "./scheduledBankPayoutLedger.util.js";
import {
  persistEmployeeScheduledPayoutLedgerIfClaimOwner,
  runWithEmployeeScheduledPayoutClaimHeartbeat,
} from "./scheduledBankPayoutProcessingClaim.service.js";
import { validateScheduledStandardPayoutDestination } from "./scheduledBankPayoutDestination.service.js";

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

export function __setEmployeeScheduledBankPayoutStripeFnsForTests(fns: {
  createStandardPayout?: CreateStandardPayoutFn | null;
  retrieveBalance?: RetrieveBalanceFn | null;
  listPendingPayouts?: ListPendingPayoutsFn | null;
}): void {
  createStandardPayoutFn =
    fns.createStandardPayout === undefined ? createStandardPayoutFn : fns.createStandardPayout;
  retrieveBalanceFn = fns.retrieveBalance === undefined ? retrieveBalanceFn : fns.retrieveBalance;
  listPendingPayoutsFn =
    fns.listPendingPayouts === undefined ? listPendingPayoutsFn : fns.listPendingPayouts;
}

export function __resetEmployeeScheduledBankPayoutStripeFnsForTests(): void {
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

export function employeeScheduledBankPayoutStripeIdempotencyKey(employeeId: string, dueAt: Date): string {
  const windowKey = scheduleWindowKeyFromDate(dueAt);
  return `caretip_employee_scheduled_payout:${employeeId}:${windowKey}`;
}

type EmployeeScheduledPayoutLedgerCreate = {
  employeeId: string;
  scheduleWindowKey: string;
  idempotencyKey: string;
  amountCents: number;
  currency: string;
  status: StripeConnectScheduledPayoutRequestStatus;
};

async function findEmployeeScheduledPayoutLedgerRow(
  employeeId: string,
  scheduleWindowKey: string,
): Promise<EmployeeStripeScheduledPayoutRequest | null> {
  return prisma.employeeStripeScheduledPayoutRequest.findUnique({
    where: { employeeId_scheduleWindowKey: { employeeId, scheduleWindowKey } },
  });
}

async function createEmployeeScheduledPayoutLedgerRowOrGetExisting(
  data: EmployeeScheduledPayoutLedgerCreate,
): Promise<{ row: EmployeeStripeScheduledPayoutRequest; created: boolean }> {
  const existing = await findEmployeeScheduledPayoutLedgerRow(data.employeeId, data.scheduleWindowKey);
  if (existing) return { row: existing, created: false };
  try {
    const row = await prisma.employeeStripeScheduledPayoutRequest.create({ data });
    return { row, created: true };
  } catch (err) {
    if (!isPrismaUniqueViolation(err)) throw err;
    for (let attempt = 0; attempt < 4; attempt++) {
      const raced =
        (await findEmployeeScheduledPayoutLedgerRow(data.employeeId, data.scheduleWindowKey)) ??
        (await prisma.employeeStripeScheduledPayoutRequest.findUnique({
          where: { idempotencyKey: data.idempotencyKey },
        }));
      if (raced) return { row: raced, created: false };
      await new Promise((resolve) => setTimeout(resolve, 15 * (attempt + 1)));
    }
    throw err;
  }
}

async function advanceEmployeeEvery3DaysWindow(employeeId: string, previousAnchorUtc: Date): Promise<void> {
  const row = await prisma.employeeStripeAccount.findUnique({
    where: { employeeId },
    select: { employee: { select: { business: { select: { timezone: true } } } } },
  });
  if (!row) return;
  const next = computeNextEvery3DaysPayoutAt({
    timezone: row.employee.business.timezone,
    previousAnchorUtc,
  });
  await prisma.employeeStripeAccount.update({
    where: { employeeId },
    data: { bankPayoutNextScheduledAt: next },
  });
}

export async function runScheduledBankPayoutForEmployee(
  employeeId: string,
): Promise<ScheduledBankPayoutRunResult> {
  if (!isStripeConfigured() && !createStandardPayoutFn) {
    return { outcome: "skipped" };
  }

  return runSerializedByKey(`scheduled-bank-payout:employee:${employeeId}`, async () => {
    const account = await prisma.employeeStripeAccount.findUnique({
      where: { employeeId },
      select: {
        employeeId: true,
        bankPayoutSchedule: true,
        bankPayoutNextScheduledAt: true,
        stripeAccountId: true,
        stripePayoutsEnabled: true,
        employee: {
          select: {
            isDeleted: true,
            isActive: true,
            activationStatus: true,
            user: { select: { legalHold: true, isActive: true } },
            business: { select: { deletedAt: true, legalHold: true } },
          },
        },
      },
    });
    if (!account) return { outcome: "skipped" };
    if (account.bankPayoutSchedule !== BusinessBankPayoutSchedule.every_3_days) {
      return { outcome: "skipped" };
    }
    const emp = account.employee;
    if (
      emp.isDeleted ||
      !emp.isActive ||
      emp.activationStatus !== "active" ||
      !emp.user?.isActive ||
      emp.user.legalHold ||
      emp.business.deletedAt ||
      emp.business.legalHold
    ) {
      return { outcome: "blocked" };
    }
    const stripeAccountId = account.stripeAccountId?.trim();
    if (!stripeAccountId || !account.stripePayoutsEnabled) return { outcome: "blocked" };

    const dueAt = account.bankPayoutNextScheduledAt;
    if (!dueAt || dueAt.getTime() > Date.now()) return { outcome: "not_due" };

    const windowKey = scheduleWindowKeyFromDate(dueAt);
    const idempotencyKey = employeeScheduledBankPayoutStripeIdempotencyKey(employeeId, dueAt);

    const existing = await findEmployeeScheduledPayoutLedgerRow(employeeId, windowKey);
    if (existing?.status === StripeConnectScheduledPayoutRequestStatus.submitted && existing.stripePayoutId) {
      await advanceEmployeeEvery3DaysWindow(employeeId, dueAt);
      return { outcome: "created", stripePayoutId: existing.stripePayoutId };
    }
    if (existing?.status === StripeConnectScheduledPayoutRequestStatus.skipped_zero_balance) {
      await advanceEmployeeEvery3DaysWindow(employeeId, dueAt);
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
      const { row } = await createEmployeeScheduledPayoutLedgerRowOrGetExisting({
        employeeId,
        scheduleWindowKey: windowKey,
        idempotencyKey,
        amountCents: 0,
        currency,
        status: StripeConnectScheduledPayoutRequestStatus.skipped_zero_balance,
      });
      if (row.status !== StripeConnectScheduledPayoutRequestStatus.skipped_zero_balance) {
        await prisma.employeeStripeScheduledPayoutRequest.update({
          where: { id: row.id },
          data: { status: StripeConnectScheduledPayoutRequestStatus.skipped_zero_balance },
        });
      }
      await advanceEmployeeEvery3DaysWindow(employeeId, dueAt);
      return { outcome: "zero" };
    }

    const { row: request, created: ledgerCreated } =
      await createEmployeeScheduledPayoutLedgerRowOrGetExisting({
        employeeId,
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
      await advanceEmployeeEvery3DaysWindow(employeeId, dueAt);
      return { outcome: "created", stripePayoutId: request.stripePayoutId };
    }
    if (request.status === StripeConnectScheduledPayoutRequestStatus.skipped_zero_balance) {
      await advanceEmployeeEvery3DaysWindow(employeeId, dueAt);
      return { outcome: "zero" };
    }
    const gate = await gateScheduledLedgerBeforeCreate({
      stripeAccountId,
      ledger: employeeScheduledLedgerSnapshot(request),
      ledgerCreated,
      listPendingFn: hasPendingStandardPayout,
    });
    if (gate.action === "reconciled") {
      await prisma.employeeStripeScheduledPayoutRequest.update({
        where: { id: request.id },
        data: {
          status: StripeConnectScheduledPayoutRequestStatus.submitted,
          stripePayoutId: gate.stripePayoutId,
          reconciliationStatus: ScheduledPayoutReconciliationStatus.resolved,
          blockedReason: null,
        },
      });
      await persistEmployeePayoutFromStripeObject({
        employeeId,
        stripeAccountId,
        payout: gate.stripePayout,
      });
      await advanceEmployeeEvery3DaysWindow(employeeId, dueAt);
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
    const claimRun = await runWithEmployeeScheduledPayoutClaimHeartbeat(
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
              "employeeScheduledBankPayout.create",
              new Error(diagnostics.failureMessage ?? "Payout destination blocked"),
              {
                employeeId,
                windowKey,
                idempotencyKey,
                correlationId,
                destinationBlocked: true,
                failureCode: diagnostics.failureCode,
              },
              diagnostics,
            );
            const ledgerUpdate = diagnosticsToLedgerUpdate(diagnostics, nextAttemptCount);
            await persistEmployeeScheduledPayoutLedgerIfClaimOwner({
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
          const submitted = await persistEmployeeScheduledPayoutLedgerIfClaimOwner({
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
          logScheduledPayoutCreateFailure("employeeScheduledBankPayout.create", err, {
            employeeId,
            windowKey,
            idempotencyKey,
            correlationId,
          }, diagnostics);
          const ledgerUpdate = diagnosticsToLedgerUpdate(diagnostics, nextAttemptCount);
          await persistEmployeeScheduledPayoutLedgerIfClaimOwner({
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
      await prisma.employeeStripeScheduledPayoutRequest.updateMany({
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
      await persistEmployeePayoutFromStripeObject({
        employeeId,
        stripeAccountId,
        payout: stripePayout,
      });
    } catch (observeErr) {
      logServerError("employeeScheduledBankPayout.observePayout", observeErr, {
        employeeId,
        stripePayoutId: stripePayout.id,
      });
    }
    await advanceEmployeeEvery3DaysWindow(employeeId, dueAt);
    return { outcome: "created", stripePayoutId: stripePayout.id };
  });
}

/** Ops recovery for a specific ledger — only when it matches the account's current due window. */
export async function runScheduledBankPayoutRecoveryForEmployeeLedger(
  ledgerId: string,
): Promise<ScheduledBankPayoutRunResult> {
  const request = await prisma.employeeStripeScheduledPayoutRequest.findUnique({
    where: { id: ledgerId },
  });
  if (!request) return { outcome: "blocked", blockedReason: "ledger_not_found" };
  if (
    request.status === StripeConnectScheduledPayoutRequestStatus.submitted &&
    request.stripePayoutId?.startsWith("po_")
  ) {
    return { outcome: "blocked", blockedReason: "already_submitted" };
  }
  const account = await prisma.employeeStripeAccount.findUnique({
    where: { employeeId: request.employeeId },
    select: { bankPayoutNextScheduledAt: true },
  });
  const dueAt = account?.bankPayoutNextScheduledAt;
  if (!dueAt) return { outcome: "blocked", blockedReason: "no_scheduled_due" };
  const windowKey = scheduleWindowKeyFromDate(dueAt);
  if (windowKey !== request.scheduleWindowKey) {
    return { outcome: "blocked", blockedReason: "ledger_window_not_current" };
  }
  return runScheduledBankPayoutForEmployee(request.employeeId);
}

export type ScheduledBankPayoutTickCounts = {
  scanned: number;
  processed: number;
  created: number;
  zero: number;
  blocked: number;
  notDue: number;
  skipped: number;
  retryScheduled: number;
  blockedReasons: Record<string, number>;
  capReached: boolean;
  dueBacklogBefore: number;
  dueBacklogAfter: number;
  /** Keyset rotations to ring start during this tick (D2 fairness). */
  fairnessWraps: number;
  cursorSave: import("./scheduledBankPayoutDueSelection.service.js").FairScheduledPayoutTickAccumulator["cursorSave"];
};

export async function tickEmployeeScheduledBankPayouts(): Promise<ScheduledBankPayoutTickCounts> {
  const now = new Date();
  const { countDueEmployeeScheduledBankPayoutAccounts } = await import(
    "./scheduledBankPayoutDueBacklog.service.js"
  );
  const {
    fetchDueEmployeeScheduledBankPayoutBatch,
    runFairScheduledBankPayoutStreamTick,
  } = await import("./scheduledBankPayoutDueSelection.service.js");
  const dueBacklogBefore = await countDueEmployeeScheduledBankPayoutAccounts(now);

  const fair = await runFairScheduledBankPayoutStreamTick({
    stream: "employee",
    now,
    fetchBatch: (after, limit) => fetchDueEmployeeScheduledBankPayoutBatch({ now, after, limit }),
    processAccount: (employeeId) => runScheduledBankPayoutForEmployee(employeeId),
    onProcessError: (employeeId, err) => {
      logServerError("employeeScheduledBankPayout.tick.employee", err, { employeeId });
    },
  });

  const dueBacklogAfter = await countDueEmployeeScheduledBankPayoutAccounts(new Date());
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
