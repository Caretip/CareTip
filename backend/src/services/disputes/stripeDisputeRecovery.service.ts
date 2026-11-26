/**
 * Stage 1 chargeback recovery: administrator-approved Stripe transfer reversals.
 *
 * Policy (2026-11-26, "stage1"):
 *  - Available by default (no feature switch), but NEVER automatic because a dispute is lost.
 *    Webhooks, reconciliation, tip backfill and admin "sync" only record the loss and its exposure.
 *  - A platform admin (DB-verified SUPER_ADMIN, MFA at login) reviews a LOST dispute and approves a
 *    recovery with explicit confirmation. The approval fixes the scope: one transfer, one connected
 *    account, and a maximum amount (never more than the beneficiary's share).
 *  - Within an approval CareTip may retry (scheduled, bounded, with back-off) after a reversal could not
 *    be completed for lack of available funds. Retries never exceed the approval, never target another
 *    transfer, never push the account below its available balance, and stop when the dispute is won or
 *    its funds are reinstated.
 *
 * Stripe is authoritative: the dispute is re-read and must be `lost`; the transfer, its
 * `amount_reversed` and the reversals tagged with this dispute bound every amount; the connected
 * account's available balance (GET /v1/balance as that account) is read before each request.
 * Stripe documents that a reversal can fail when the account lacks available funds and recommends
 * retrying when funds become available (docs.stripe.com/connect/disputes). It does not document that
 * a reversal can recall money already paid out to a bank account: that is Stage 2 (not implemented).
 *
 * Idempotency: a request that may have reached Stripe (network error, 5xx, 409) is "unknown" and is
 * only ever retried with its ORIGINAL key after reading the transfer's reversals. A definite refusal
 * (other 4xx) is "failed": Stripe stores that error under the key for 24h, so a later legitimate
 * request uses a new key (suffix :rN). A key is never replaced while its outcome is unknown.
 */
import type Stripe from "stripe";
import {
  StripeDisputeRecoveryAttemptStatus,
  StripeDisputeRecoveryStatus,
  StripeDisputeSubjectKind,
} from "@prisma/client";
import { prisma } from "../../prisma.js";
import { getStripeClient } from "../stripe.service.js";
import { logServerError } from "../../utils/httpErrors.js";
import { runSerializedByKey } from "../../utils/serializedByKey.js";
import { isRecoverableSubject, syncStripeDisputeFromStripe } from "./stripeDisputeProjection.service.js";
import { notifyStripeDisputeEvent } from "./stripeDisputeNotify.service.js";

export const RECOVERY_POLICY_VERSION = "stage1-2026-11-26";
/** Cross-instance claim lease; a Stripe call times out well before this. */
export const RECOVERY_CLAIM_LEASE_MS = 2 * 60_000;
/** Scheduled retries per approval (about two weeks with the back-off below). */
export const RECOVERY_MAX_SCHEDULED_RETRIES = 20;

export function recoveryRetryDelayMs(retryCount: number): number {
  return Math.min(24 * 3600_000, 3600_000 * 2 ** Math.max(0, retryCount));
}

export class DisputeRecoveryError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus = 409,
  ) {
    super(message);
    this.name = "DisputeRecoveryError";
  }
}

/**
 * Destination charge: what the beneficiary actually received for the disputed amount (CareTip kept its
 * application fee). Proportional for partial disputes.
 */
export function beneficiaryShareCents(args: {
  disputeAmountCents: number;
  chargeAmountCents: number | null;
  applicationFeeCents: number | null;
}): number {
  const charge = args.chargeAmountCents ?? 0;
  const fee = Math.max(0, args.applicationFeeCents ?? 0);
  if (charge <= 0) return 0;
  const share = Math.floor((args.disputeAmountCents * Math.max(0, charge - fee)) / charge);
  return Math.max(0, Math.min(share, args.disputeAmountCents));
}

type DisputeRow = NonNullable<Awaited<ReturnType<typeof prisma.stripeDispute.findUnique>>>;

/** The transfer to recover from and the most that may ever be recovered for this dispute. */
export async function recoveryTarget(
  row: DisputeRow,
): Promise<{ transferId: string; targetCents: number; expectedAccountId: string | null } | null> {
  if (row.subjectKind === StripeDisputeSubjectKind.tip_platform_hold) {
    if (!row.transactionId) return null;
    const payable = await prisma.employeeTipPayable.findUnique({
      where: { transactionId: row.transactionId },
      select: { stripeTransferId: true, stripeChargeId: true, transferredCents: true, disputedLostCents: true, stripeDestinationAccountId: true },
    });
    if (!payable?.stripeTransferId || payable.transferredCents <= 0) return null;
    if (row.stripeChargeId && payable.stripeChargeId && payable.stripeChargeId !== row.stripeChargeId) return null;
    return {
      transferId: payable.stripeTransferId,
      targetCents: Math.min(payable.disputedLostCents, payable.transferredCents),
      expectedAccountId: payable.stripeDestinationAccountId ?? null,
    };
  }
  if (
    (row.subjectKind === StripeDisputeSubjectKind.tip_destination_business ||
      row.subjectKind === StripeDisputeSubjectKind.tip_destination_employee) &&
    row.destinationTransferId &&
    row.destinationAccountId
  ) {
    return {
      transferId: row.destinationTransferId,
      expectedAccountId: row.destinationAccountId,
      targetCents: beneficiaryShareCents({
        disputeAmountCents: row.amountCents,
        chargeAmountCents: row.chargeAmountCents,
        applicationFeeCents: row.applicationFeeCents,
      }),
    };
  }
  return null;
}

type ReversalLite = { id: string; amount: number; created: number | null; metadata: Stripe.Metadata | null };
export type TransferState = {
  id: string;
  amount: number;
  amountReversed: number;
  currency: string;
  destination: string | null;
  reversals: ReversalLite[];
};

export async function readTransfer(transferId: string): Promise<TransferState> {
  const stripe = getStripeClient();
  const transfer = await stripe.transfers.retrieve(transferId);
  const reversals: ReversalLite[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < 10; page++) {
    const list = await stripe.transfers.listReversals(transferId, {
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    reversals.push(
      ...list.data.map((r) => ({ id: r.id, amount: r.amount, created: r.created ?? null, metadata: r.metadata ?? null })),
    );
    if (!list.has_more || list.data.length === 0) break;
    startingAfter = list.data[list.data.length - 1]!.id;
  }
  const destination = typeof transfer.destination === "string" ? transfer.destination : transfer.destination?.id ?? null;
  return {
    id: transfer.id,
    amount: transfer.amount,
    amountReversed: transfer.amount_reversed ?? 0,
    currency: String(transfer.currency ?? "eur").toLowerCase(),
    destination,
    reversals,
  };
}

/** Available balance of a connected account in one currency (GET /v1/balance as that account). */
export async function readConnectedAvailableCents(account: string, currency: string): Promise<number | null> {
  try {
    const balance = await getStripeClient().balance.retrieve({}, { stripeAccount: account });
    const row = (balance.available ?? []).find((b) => String(b.currency).toLowerCase() === currency.toLowerCase());
    return typeof row?.amount === "number" ? row.amount : 0;
  } catch (err) {
    logServerError("stripeDispute.recovery.balance", err, { accountSuffix: account.slice(-8) });
    return null;
  }
}

/**
 * The transfer read from Stripe must belong to this dispute: same currency as the dispute (amounts are
 * never compared across currencies) and paid to the account CareTip recorded for the beneficiary.
 */
function assertTransferMatchesDispute(row: DisputeRow, target: { expectedAccountId: string | null }, transfer: TransferState): void {
  if (transfer.currency !== String(row.currency).toLowerCase()) {
    throw new DisputeRecoveryError("CURRENCY_MISMATCH", "The transfer is in a different currency than the dispute. Review it manually.");
  }
  if (!transfer.destination) throw new DisputeRecoveryError("NOT_RECOVERABLE", "Stripe did not return the transfer's destination account.");
  if (target.expectedAccountId && transfer.destination !== target.expectedAccountId) {
    throw new DisputeRecoveryError("ACCOUNT_MISMATCH", "The transfer was paid to a different account than CareTip recorded. Review it manually.");
  }
}

const reversalsOf = (stripeDisputeId: string, all: ReversalLite[]) =>
  all.filter((r) => r.metadata?.caretip_stripe_dispute_id === stripeDisputeId);

/** Most that may be recovered right now: the approval (if any) and the beneficiary target. */
function capCents(row: DisputeRow, targetCents: number): number {
  return row.recoveryApprovedCents != null ? Math.min(row.recoveryApprovedCents, targetCents) : targetCents;
}

/** Marks an attempt succeeded exactly once and, for platform-hold tips, records it on the payable. */
async function markAttemptSucceeded(row: DisputeRow, attemptId: string, reversal: { id: string; amount: number }): Promise<void> {
  const changed = await prisma.stripeDisputeRecoveryAttempt.updateMany({
    where: { id: attemptId, disputeId: row.id, status: { not: StripeDisputeRecoveryAttemptStatus.succeeded } },
    data: {
      status: StripeDisputeRecoveryAttemptStatus.succeeded,
      stripeReversalId: reversal.id,
      amountCents: reversal.amount,
      completedAt: new Date(),
      errorCode: null,
      errorMessage: null,
    },
  });
  if (changed.count === 1 && row.subjectKind === StripeDisputeSubjectKind.tip_platform_hold && row.transactionId) {
    const { recordDisputeRecoveryReversalOnPayable } = await import("../employeeTipPayable.service.js");
    await recordDisputeRecoveryReversalOnPayable({ transactionId: row.transactionId, amountCents: reversal.amount });
  }
}

const INSUFFICIENT_CODES = new Set(["insufficient_funds", "balance_insufficient", "insufficient_available_balance"]);
export function isInsufficientFundsError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  if (err.code && INSUFFICIENT_CODES.has(err.code)) return true;
  return /insufficient (available )?(funds|balance)/i.test(String(err.message ?? ""));
}

/** A Stripe answer that proves nothing was executed (other than a 409 conflict). */
export function isDefiniteStripeRefusal(err: unknown): boolean {
  const status = (err as { statusCode?: unknown })?.statusCode;
  return typeof status === "number" && status >= 400 && status < 500 && status !== 409;
}

/**
 * Stripe-side truth for one dispute: matches attempts to Stripe reversals, stores the recovered sum
 * and the resulting status. Reads only.
 */
export async function applyStripeRecoveryState(disputeRowId: string): Promise<{ recoveredCents: number; targetCents: number; capCents: number }> {
  const row = await prisma.stripeDispute.findUniqueOrThrow({ where: { id: disputeRowId } });
  const target = await recoveryTarget(row);
  if (!target) return { recoveredCents: row.recoveredCents, targetCents: 0, capCents: 0 };
  const state = await readTransfer(target.transferId);
  const mine = reversalsOf(row.stripeDisputeId, state.reversals);
  for (const reversal of mine) {
    const attemptId = reversal.metadata?.caretip_recovery_attempt_id;
    if (attemptId) await markAttemptSucceeded(row, attemptId, reversal);
  }
  const recoveredCents = mine.reduce((sum, r) => sum + r.amount, 0);
  const cap = capCents(row, target.targetCents);
  const open = await prisma.stripeDisputeRecoveryAttempt.count({
    where: { disputeId: row.id, status: { in: [StripeDisputeRecoveryAttemptStatus.pending, StripeDisputeRecoveryAttemptStatus.unknown] } },
  });
  const approved = row.recoveryApprovedAt != null && row.recoveryCancelledAt == null;
  let status: StripeDisputeRecoveryStatus;
  let clearRetry = false;
  if (row.recoveryCancelledAt) status = StripeDisputeRecoveryStatus.cancelled;
  else if (cap > 0 && recoveredCents >= cap) {
    status = StripeDisputeRecoveryStatus.recovered;
    clearRetry = true;
  } else if (open > 0) status = StripeDisputeRecoveryStatus.in_progress;
  else if (approved && row.recoveryNextRetryAt) {
    status = recoveredCents > 0 ? StripeDisputeRecoveryStatus.partially_recovered : StripeDisputeRecoveryStatus.outstanding;
  } else if (approved && row.recoveryLastFailureCode) status = StripeDisputeRecoveryStatus.failed;
  else if (approved) status = recoveredCents > 0 ? StripeDisputeRecoveryStatus.partially_recovered : StripeDisputeRecoveryStatus.outstanding;
  else status = recoveredCents > 0 ? StripeDisputeRecoveryStatus.partially_recovered : StripeDisputeRecoveryStatus.review_required;
  await prisma.stripeDispute.update({
    where: { id: row.id },
    data: { recoveredCents, recoveryStatus: status, ...(clearRetry ? { recoveryNextRetryAt: null } : {}) },
  });
  return { recoveredCents, targetCents: target.targetCents, capCents: cap };
}

// ───────────────────────── claim ─────────────────────────

async function claim(rowId: string): Promise<StripeDisputeRecoveryStatus | null> {
  const before = await prisma.stripeDispute.findUnique({ where: { id: rowId }, select: { recoveryStatus: true } });
  const claimed = await prisma.stripeDispute.updateMany({
    where: {
      id: rowId,
      OR: [{ recoveryClaimedAt: null }, { recoveryClaimedAt: { lt: new Date(Date.now() - RECOVERY_CLAIM_LEASE_MS) } }],
    },
    data: { recoveryClaimedAt: new Date() },
  });
  return claimed.count === 1 ? before?.recoveryStatus ?? null : null;
}

async function releaseClaim(rowId: string): Promise<void> {
  await prisma.stripeDispute.updateMany({ where: { id: rowId }, data: { recoveryClaimedAt: null } }).catch(() => undefined);
}

// ───────────────────────── outcome changes ─────────────────────────

/**
 * Stops an approved recovery when Stripe says nothing is owed any more (dispute won, inquiry closed,
 * funds reinstated). Moves no money: money already recovered is flagged for an admin decision.
 */
export async function cancelRecoveryForOutcome(rowId: string, reason: string, actorUserId: string | null = null): Promise<boolean> {
  const row = await prisma.stripeDispute.findUnique({ where: { id: rowId } });
  if (!row || !row.recoveryApprovedAt || row.recoveryCancelledAt) return false;
  const changed = await prisma.stripeDispute.updateMany({
    where: { id: rowId, recoveryCancelledAt: null },
    data: {
      recoveryCancelledAt: new Date(),
      recoveryCancelReason: reason.slice(0, 200),
      recoveryNextRetryAt: null,
      recoveryStatus: StripeDisputeRecoveryStatus.cancelled,
      ...(row.recoveredCents > 0
        ? { recoveryNote: "Recovered funds may no longer be owed. An admin decides whether to return them; nothing is transferred automatically." }
        : {}),
    },
  });
  if (changed.count !== 1) return false;
  await prisma.auditLog.create({
    data: {
      userId: actorUserId,
      action: "stripe_dispute.recovery_cancelled",
      metadata: JSON.stringify({ stripeDisputeId: row.stripeDisputeId, reason, recoveredCents: row.recoveredCents }),
    },
  });
  await notifyStripeDisputeEvent(row.id, "recovery_cancelled", row.recoveryApprovedAt.toISOString());
  return true;
}

// ───────────────────────── approval and attempts ─────────────────────────

export type RecoveryResult = {
  attemptId: string | null;
  status: StripeDisputeRecoveryAttemptStatus | "nothing_to_recover" | "deferred" | "cancelled";
  amountCents: number;
  recoveredCents: number;
  targetCents: number;
  outstandingCents: number;
  nextRetryAt: string | null;
  reason?: string;
};

/** Admin approval (with confirmation, checked by the controller) followed by the first attempt. */
export async function approveAndRecover(args: {
  disputeRowId: string;
  adminUserId: string;
  /** Optional amount to approve now; never more than the beneficiary's share. */
  amountCents?: number;
}): Promise<RecoveryResult> {
  if (args.amountCents !== undefined && (!Number.isInteger(args.amountCents) || args.amountCents <= 0)) {
    throw new DisputeRecoveryError("INVALID_AMOUNT", "Enter a whole positive amount in cents.", 400);
  }
  return runSerializedByKey(`dispute_recovery:${args.disputeRowId}`, async () => {
    const head = await prisma.stripeDispute.findUnique({ where: { id: args.disputeRowId } });
    if (!head) throw new DisputeRecoveryError("NOT_FOUND", "Dispute not found.", 404);
    await syncStripeDisputeFromStripe(head.stripeDisputeId, { source: "admin", stripeEventAccount: head.stripeEventAccountId });
    const row = await prisma.stripeDispute.findUniqueOrThrow({ where: { id: head.id } });
    if (row.stripeStatus !== "lost") {
      throw new DisputeRecoveryError("DISPUTE_NOT_LOST", "Recovery is only possible after Stripe closes the dispute as lost.");
    }
    if (row.fundsReinstatedCents > 0) {
      throw new DisputeRecoveryError("FUNDS_REINSTATED", "Stripe reinstated the disputed funds; nothing is owed.");
    }
    const target = isRecoverableSubject(row.subjectKind) ? await recoveryTarget(row) : null;
    if (!target) throw new DisputeRecoveryError("NOT_RECOVERABLE", "This dispute has no verified transfer to recover from. Review it manually.");
    const transfer = await readTransfer(target.transferId);
    assertTransferMatchesDispute(row, target, transfer);
    const already = reversalsOf(row.stripeDisputeId, transfer.reversals).reduce((s, r) => s + r.amount, 0);
    const approvedCents = Math.min(
      target.targetCents,
      args.amountCents !== undefined ? already + args.amountCents : target.targetCents,
    );
    if (approvedCents <= already) {
      throw new DisputeRecoveryError("NOTHING_TO_APPROVE", "Nothing is left to recover for this dispute.");
    }
    const approvedAt = new Date();
    await prisma.stripeDispute.update({
      where: { id: row.id },
      data: {
        recoveryApprovedCents: approvedCents,
        recoveryApprovedBy: args.adminUserId,
        recoveryApprovedAt: approvedAt,
        recoveryPolicyVersion: RECOVERY_POLICY_VERSION,
        recoveryTransferId: target.transferId,
        recoveryConnectedAccountId: transfer.destination,
        recoveryCancelledAt: null,
        recoveryCancelReason: null,
        recoveryNextRetryAt: null,
        recoveryRetryCount: 0,
        recoveryLastFailureCode: null,
        recoveryLastFailureAt: null,
        recoveryStatus: StripeDisputeRecoveryStatus.outstanding,
      },
    });
    await prisma.auditLog.create({
      data: {
        userId: args.adminUserId,
        action: "stripe_dispute.recovery_approved",
        metadata: JSON.stringify({
          stripeDisputeId: row.stripeDisputeId,
          approvedCents,
          alreadyRecoveredCents: already,
          targetCents: target.targetCents,
          transferId: target.transferId,
          connectedAccountSuffix: transfer.destination!.slice(-8),
          policy: RECOVERY_POLICY_VERSION,
        }),
      },
    });
    await notifyStripeDisputeEvent(row.id, "recovery_approved", approvedAt.toISOString());
    return attemptWithinApproval(row.id, { trigger: "admin", actorUserId: args.adminUserId, synced: true });
  });
}

/** Admin "retry now" within an existing approval. */
export async function retryApprovedRecovery(args: { disputeRowId: string; adminUserId: string }): Promise<RecoveryResult> {
  return runSerializedByKey(`dispute_recovery:${args.disputeRowId}`, () =>
    attemptWithinApproval(args.disputeRowId, { trigger: "admin", actorUserId: args.adminUserId }),
  );
}

/** Admin cancellation of an approval (stops retries; moves no money). */
export async function cancelApprovedRecovery(args: { disputeRowId: string; adminUserId: string; reason: string }): Promise<boolean> {
  const reason = args.reason.trim();
  if (!reason) throw new DisputeRecoveryError("REASON_REQUIRED", "Give a reason for cancelling the recovery.", 400);
  return cancelRecoveryForOutcome(args.disputeRowId, `admin: ${reason}`, args.adminUserId);
}

async function scheduleRetry(row: DisputeRow, failureCode: string, scheduled: boolean): Promise<{ nextRetryAt: Date | null; exhausted: boolean }> {
  const retryCount = row.recoveryRetryCount + (scheduled ? 1 : 0);
  if (retryCount >= RECOVERY_MAX_SCHEDULED_RETRIES) {
    await prisma.stripeDispute.update({
      where: { id: row.id },
      data: { recoveryRetryCount: retryCount, recoveryNextRetryAt: null, recoveryLastFailureCode: "retries_exhausted", recoveryLastFailureAt: new Date() },
    });
    await notifyStripeDisputeEvent(row.id, "recovery_retries_exhausted", row.recoveryApprovedAt?.toISOString() ?? "");
    return { nextRetryAt: null, exhausted: true };
  }
  const nextRetryAt = new Date(Date.now() + recoveryRetryDelayMs(retryCount));
  await prisma.stripeDispute.update({
    where: { id: row.id },
    data: { recoveryRetryCount: retryCount, recoveryNextRetryAt: nextRetryAt, recoveryLastFailureCode: failureCode.slice(0, 64), recoveryLastFailureAt: new Date() },
  });
  return { nextRetryAt, exhausted: false };
}

async function finish(
  rowId: string,
  partial: { attemptId: string | null; status: RecoveryResult["status"]; amountCents: number; reason?: string },
): Promise<RecoveryResult> {
  const state = await applyStripeRecoveryState(rowId);
  const row = await prisma.stripeDispute.findUniqueOrThrow({ where: { id: rowId }, select: { recoveryNextRetryAt: true } });
  return {
    ...partial,
    recoveredCents: state.recoveredCents,
    targetCents: state.targetCents,
    outstandingCents: Math.max(0, state.capCents - state.recoveredCents),
    nextRetryAt: row.recoveryNextRetryAt?.toISOString() ?? null,
  };
}

/**
 * One attempt under an existing approval. Used by the admin (approve / retry now) and by the scheduled
 * retry. Refuses without an active approval: there is no path that reverses money without one.
 */
async function attemptWithinApproval(
  rowId: string,
  opts: { trigger: "admin" | "scheduled_retry"; actorUserId: string | null; synced?: boolean },
): Promise<RecoveryResult> {
  const previousStatus = await claim(rowId);
  if (previousStatus === null) {
    throw new DisputeRecoveryError("RECOVERY_IN_PROGRESS", "A recovery for this dispute is in progress. Refresh in a moment.");
  }
  const scheduled = opts.trigger === "scheduled_retry";
  let attemptId: string | null = null;
  try {
    let row = await prisma.stripeDispute.findUniqueOrThrow({ where: { id: rowId } });
    if (!row.recoveryApprovedAt || row.recoveryApprovedCents == null || row.recoveryCancelledAt) {
      throw new DisputeRecoveryError("NOT_APPROVED", "This recovery has not been approved by an admin.");
    }
    if (!opts.synced) {
      await syncStripeDisputeFromStripe(row.stripeDisputeId, { source: scheduled ? "reconciliation" : "admin", stripeEventAccount: row.stripeEventAccountId });
      row = await prisma.stripeDispute.findUniqueOrThrow({ where: { id: rowId } });
    }
    if (row.recoveryCancelledAt) {
      return { attemptId: null, status: "cancelled", amountCents: 0, recoveredCents: row.recoveredCents, targetCents: 0, outstandingCents: 0, nextRetryAt: null };
    }
    // Stripe says nothing is owed any more: stop.
    if (row.stripeStatus !== "lost" || row.fundsReinstatedCents > 0) {
      await cancelRecoveryForOutcome(row.id, row.stripeStatus !== "lost" ? `dispute_${row.stripeStatus}` : "funds_reinstated");
      return { attemptId: null, status: "cancelled", amountCents: 0, recoveredCents: row.recoveredCents, targetCents: 0, outstandingCents: 0, nextRetryAt: null };
    }
    const target = await recoveryTarget(row);
    if (!target || target.transferId !== row.recoveryTransferId) {
      throw new DisputeRecoveryError("SCOPE_CHANGED", "The transfer no longer matches the approval. Review and approve again.");
    }
    if (await prisma.stripeDisputeRecoveryAttempt.count({ where: { disputeId: row.id, status: { in: [StripeDisputeRecoveryAttemptStatus.pending, StripeDisputeRecoveryAttemptStatus.unknown] } } })) {
      await applyStripeRecoveryState(row.id);
    }
    const transfer = await readTransfer(target.transferId);
    assertTransferMatchesDispute(row, target, transfer);
    if (transfer.destination !== row.recoveryConnectedAccountId) {
      throw new DisputeRecoveryError("SCOPE_CHANGED", "The transfer's account no longer matches the approval.");
    }
    const already = reversalsOf(row.stripeDisputeId, transfer.reversals).reduce((s, r) => s + r.amount, 0);
    const cap = capCents(row, target.targetCents);
    const remaining = Math.max(0, cap - already);
    const transferLeft = Math.max(0, transfer.amount - transfer.amountReversed);
    if (remaining <= 0) return finish(row.id, { attemptId: null, status: "nothing_to_recover", amountCents: 0 });
    if (transferLeft <= 0) {
      await prisma.stripeDispute.update({
        where: { id: row.id },
        data: { recoveryNote: "Transfer already fully reversed (for example by refunds); nothing left to recover from it.", recoveryNextRetryAt: null },
      });
      return finish(row.id, { attemptId: null, status: "nothing_to_recover", amountCents: 0 });
    }

    const stillUncertain = await prisma.stripeDisputeRecoveryAttempt.findFirst({
      where: { disputeId: row.id, status: { in: [StripeDisputeRecoveryAttemptStatus.pending, StripeDisputeRecoveryAttemptStatus.unknown] } },
      orderBy: { createdAt: "asc" },
    });
    const available = stillUncertain ? null : await readConnectedAvailableCents(transfer.destination!, transfer.currency);

    let amount: number;
    let idempotencyKey: string;
    if (stillUncertain) {
      // Not found at Stripe: repeat the SAME request (same key, same amount) or nothing.
      if (stillUncertain.amountCents > Math.min(remaining, transferLeft)) {
        throw new DisputeRecoveryError("RECOVERY_UNCERTAIN", "An earlier request has an unknown outcome and no longer fits. Wait for reconciliation.");
      }
      amount = stillUncertain.amountCents;
      idempotencyKey = stillUncertain.idempotencyKey;
      attemptId = stillUncertain.id;
      await prisma.stripeDisputeRecoveryAttempt.update({ where: { id: attemptId }, data: { status: StripeDisputeRecoveryAttemptStatus.pending } });
    } else {
      if (available === null) {
        await scheduleRetry(row, "balance_unavailable", scheduled);
        return finish(row.id, { attemptId: null, status: "deferred", amountCents: 0, reason: "balance_unavailable" });
      }
      // Never request more than the account has available: recovery never creates a negative balance.
      amount = Math.min(remaining, transferLeft, Math.max(0, available));
      if (amount <= 0) {
        await scheduleRetry(row, "insufficient_available_balance", scheduled);
        await notifyStripeDisputeEvent(row.id, "recovery_insufficient_funds", row.recoveryApprovedAt!.toISOString());
        return finish(row.id, { attemptId: null, status: "deferred", amountCents: 0, reason: "insufficient_available_balance" });
      }
      const base = `dispute_recovery:${row.stripeDisputeId}:${already}:${amount}`;
      const refusedWithBase = await prisma.stripeDisputeRecoveryAttempt.count({
        where: { disputeId: row.id, status: StripeDisputeRecoveryAttemptStatus.failed, idempotencyKey: { startsWith: base } },
      });
      idempotencyKey = (refusedWithBase > 0 ? `${base}:r${refusedWithBase}` : base).slice(0, 191);
      const attempt = await prisma.stripeDisputeRecoveryAttempt.create({
        data: {
          disputeId: row.id,
          stripeTransferId: target.transferId,
          amountCents: amount,
          idempotencyKey,
          requestedBy: opts.actorUserId,
          trigger: opts.trigger,
          connectedAvailableCents: available,
          transferReversedBeforeCents: transfer.amountReversed,
        },
      });
      attemptId = attempt.id;
    }
    await prisma.auditLog.create({
      data: {
        userId: opts.actorUserId,
        action: "stripe_dispute.recovery_requested",
        metadata: JSON.stringify({ stripeDisputeId: row.stripeDisputeId, attemptId, amountCents: amount, trigger: opts.trigger, transferId: target.transferId, idempotencyKey, availableCents: available }),
      },
    });

    let outcome: "succeeded" | "insufficient" | "refused" | "unknown" = "unknown";
    try {
      const reversal = await getStripeClient().transfers.createReversal(
        target.transferId,
        { amount, metadata: { caretip_stripe_dispute_id: row.stripeDisputeId, caretip_recovery_attempt_id: attemptId } },
        { idempotencyKey },
      );
      // Record what Stripe answered, but count it as succeeded only when the reversal is read back from
      // the transfer (applyStripeRecoveryState below). Not visible yet: stays pending for reconciliation.
      const requestId = (reversal as unknown as { lastResponse?: { requestId?: string } }).lastResponse?.requestId;
      await prisma.stripeDisputeRecoveryAttempt.update({
        where: { id: attemptId },
        data: { stripeReversalId: reversal.id, ...(requestId ? { stripeRequestId: requestId.slice(0, 64) } : {}) },
      });
      outcome = "succeeded";
    } catch (err) {
      const e = err as { type?: string; code?: string; message?: string; requestId?: string };
      const definite = isDefiniteStripeRefusal(err);
      outcome = !definite ? "unknown" : isInsufficientFundsError(e) ? "insufficient" : "refused";
      await prisma.stripeDisputeRecoveryAttempt.update({
        where: { id: attemptId },
        data: {
          status: definite ? StripeDisputeRecoveryAttemptStatus.failed : StripeDisputeRecoveryAttemptStatus.unknown,
          errorCode: (e.code ?? e.type ?? "stripe_error").slice(0, 64),
          errorMessage: String(e.message ?? "").replace(/sk_(live|test)_[A-Za-z0-9]+/g, "sk_***").slice(0, 300),
          stripeRequestId: e.requestId?.slice(0, 64) ?? null,
          completedAt: definite ? new Date() : null,
        },
      });
      logServerError("stripeDispute.recovery.reverse", err, { stripeDisputeId: row.stripeDisputeId, attemptId, outcome });
    }

    row = await prisma.stripeDispute.findUniqueOrThrow({ where: { id: rowId } });
    if (outcome === "insufficient") {
      await scheduleRetry(row, "insufficient_funds", scheduled);
      await notifyStripeDisputeEvent(row.id, "recovery_insufficient_funds", row.recoveryApprovedAt!.toISOString());
    } else if (outcome === "unknown") {
      await scheduleRetry(row, "outcome_unknown", scheduled); // resolved from Stripe; retry reuses the same key
    } else if (outcome === "refused") {
      await prisma.stripeDispute.update({
        where: { id: row.id },
        data: { recoveryNextRetryAt: null, recoveryLastFailureCode: "stripe_refused", recoveryLastFailureAt: new Date() },
      });
      await notifyStripeDisputeEvent(row.id, "recovery_failed", attemptId);
    } else {
      await prisma.stripeDispute.update({ where: { id: row.id }, data: { recoveryLastFailureCode: null, recoveryLastFailureAt: null, recoveryNextRetryAt: null } });
    }
    const out = await finish(rowId, { attemptId, status: StripeDisputeRecoveryAttemptStatus.pending, amountCents: amount });
    const attempt = await prisma.stripeDisputeRecoveryAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    out.status = attempt.status;
    out.amountCents = attempt.amountCents;
    if (outcome === "succeeded" && attempt.status !== StripeDisputeRecoveryAttemptStatus.succeeded) {
      // Stripe accepted the request but the reversal is not visible on the transfer yet: unknown, not success.
      await prisma.stripeDisputeRecoveryAttempt.update({ where: { id: attemptId }, data: { status: StripeDisputeRecoveryAttemptStatus.unknown } });
      const fresh = await prisma.stripeDispute.findUniqueOrThrow({ where: { id: rowId } });
      await scheduleRetry(fresh, "outcome_unverified", false);
      const pendingOut = await finish(rowId, { attemptId, status: StripeDisputeRecoveryAttemptStatus.unknown, amountCents: attempt.amountCents });
      return pendingOut;
    }
    if (outcome === "succeeded") {
      if (out.outstandingCents === 0) {
        await notifyStripeDisputeEvent(rowId, "recovery_succeeded", row.recoveryApprovedAt!.toISOString());
      } else {
        // Partial: the rest stays outstanding and is retried within the approval.
        const fresh = await prisma.stripeDispute.findUniqueOrThrow({ where: { id: rowId } });
        await scheduleRetry(fresh, "partial_recovery", false);
        await notifyStripeDisputeEvent(rowId, "recovery_partial", attemptId);
        return finish(rowId, { attemptId, status: attempt.status, amountCents: attempt.amountCents });
      }
    }
    return out;
  } catch (err) {
    if (err instanceof DisputeRecoveryError) {
      // A refusal never overwrites a meaningful status.
      await prisma.stripeDispute
        .updateMany({ where: { id: rowId, recoveryStatus: StripeDisputeRecoveryStatus.in_progress }, data: { recoveryStatus: previousStatus } })
        .catch(() => undefined);
      throw err;
    }
    await applyStripeRecoveryState(rowId).catch(() => undefined);
    throw err;
  } finally {
    await releaseClaim(rowId);
  }
}

// ───────────────────────── scheduled work (internal job) ─────────────────────────

/**
 * Scheduled retries, ONLY for recoveries an admin approved and that are still owed. Bounded per run.
 * Each re-reads the dispute, the transfer and the account balance, and requests nothing when the
 * account has no available funds.
 */
export async function tickApprovedRecoveryRetries(opts?: { limit?: number; now?: Date }): Promise<{ checked: number; attempted: number; errors: number }> {
  const now = opts?.now ?? new Date();
  const due = await prisma.stripeDispute.findMany({
    where: {
      recoveryApprovedAt: { not: null },
      recoveryCancelledAt: null,
      recoveryNextRetryAt: { lte: now },
      recoveryStatus: { in: [StripeDisputeRecoveryStatus.outstanding, StripeDisputeRecoveryStatus.partially_recovered, StripeDisputeRecoveryStatus.in_progress] },
    },
    select: { id: true },
    orderBy: { recoveryNextRetryAt: "asc" },
    take: opts?.limit ?? 10,
  });
  let attempted = 0;
  let errors = 0;
  for (const d of due) {
    try {
      const r = await runSerializedByKey(`dispute_recovery:${d.id}`, () => attemptWithinApproval(d.id, { trigger: "scheduled_retry", actorUserId: null }));
      if (r.attemptId) attempted++;
    } catch (err) {
      if (!(err instanceof DisputeRecoveryError && err.code === "RECOVERY_IN_PROGRESS")) {
        errors++;
        logServerError("stripeDispute.recovery.scheduledRetry", err, { disputeRowId: d.id });
      }
    }
  }
  return { checked: due.length, attempted, errors };
}

/** Resolves pending/unknown attempts from the transfer's reversals. Reads only. */
export async function reconcileOpenRecoveryAttempts(limit = 20): Promise<{ checked: number; errors: number }> {
  const rows = await prisma.stripeDispute.findMany({
    where: {
      recoveryAttempts: { some: { status: { in: [StripeDisputeRecoveryAttemptStatus.pending, StripeDisputeRecoveryAttemptStatus.unknown] } } },
      updatedAt: { lt: new Date(Date.now() - 5 * 60_000) },
    },
    select: { id: true },
    take: limit,
  });
  let errors = 0;
  for (const r of rows) {
    try {
      await applyStripeRecoveryState(r.id);
    } catch (err) {
      errors++;
      logServerError("stripeDispute.recovery.reconcile", err, { disputeRowId: r.id });
    }
  }
  return { checked: rows.length, errors };
}

/** Admin review data, read from Stripe: transfer, reversals split by reason, and the account balance. */
export async function getRecoveryContext(disputeRowId: string) {
  const row = await prisma.stripeDispute.findUnique({ where: { id: disputeRowId } });
  if (!row) throw new DisputeRecoveryError("NOT_FOUND", "Dispute not found.", 404);
  const target = isRecoverableSubject(row.subjectKind) ? await recoveryTarget(row) : null;
  if (!target) return { recoverable: false as const };
  const transfer = await readTransfer(target.transferId);
  const forThis = reversalsOf(row.stripeDisputeId, transfer.reversals);
  const others = transfer.reversals.filter((r) => r.metadata?.caretip_stripe_dispute_id !== row.stripeDisputeId);
  const available = transfer.destination ? await readConnectedAvailableCents(transfer.destination, transfer.currency) : null;
  const recovered = forThis.reduce((s, r) => s + r.amount, 0);
  const cap = capCents(row, target.targetCents);
  return {
    recoverable: true as const,
    transferId: transfer.id,
    transferAmountCents: transfer.amount,
    transferReversedCents: transfer.amountReversed,
    transferRemainingCents: Math.max(0, transfer.amount - transfer.amountReversed),
    connectedAccountId: transfer.destination,
    connectedAvailableCents: available,
    currency: transfer.currency,
    targetCents: target.targetCents,
    approvedCents: row.recoveryApprovedCents,
    recoveredForThisDisputeCents: recovered,
    outstandingCents: Math.max(0, cap - recovered),
    reversalsForThisDispute: forThis.map((r) => ({ id: r.id, amountCents: r.amount, created: r.created })),
    otherReversals: others.map((r) => ({
      id: r.id,
      amountCents: r.amount,
      created: r.created,
      reason: r.metadata?.caretip_payable_id ? "refund" : r.metadata?.caretip_stripe_dispute_id ? "other_dispute" : "other",
    })),
  };
}
