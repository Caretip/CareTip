/**
 * Stripe dispute projection: one row per Stripe dispute, rebuilt from a fresh disputes.retrieve every
 * time (webhook, reconciliation, admin "sync", tip backfill). Stripe is the only source for status,
 * amounts, evidence state and funds movements; an event body is only a hint of which dispute changed.
 *
 * The existing ledgers are fed from the same retrieved state through upsertStripeDisputeEvent, so tip
 * refunds/disputes, employee payables (incl. the existing platform-hold reversal on a lost dispute) and
 * QR order adjustments keep working exactly as before. This module adds no second state machine: it
 * stores Stripe's raw status and only refuses to move backwards to an older Stripe snapshot.
 */
import type Stripe from "stripe";
import { Prisma, StripeDisputeRecoveryStatus, StripeDisputeSubjectKind } from "@prisma/client";
import { prisma } from "../../prisma.js";
import { getStripeClient } from "../stripe.service.js";
import { logServerError } from "../../utils/httpErrors.js";
import { runSerializedByKey } from "../../utils/serializedByKey.js";
import { notifyStripeDisputeEvent } from "./stripeDisputeNotify.service.js";

export type DisputeSyncSource = "webhook" | "reconciliation" | "admin" | "tip_backfill";

export type DisputeSyncContext = {
  source: DisputeSyncSource;
  stripeEventId?: string | null;
  stripeEventType?: string | null;
  /** Set only when the dispute lives on a connected account (event.account). */
  stripeEventAccount?: string | null;
};

export type DisputeSyncResult = {
  outcome: "created" | "updated" | "unchanged" | "stale_ignored";
  disputeRowId: string;
  stripeStatus: string;
};

const TERMINAL_STATUSES = new Set(["won", "lost", "warning_closed", "prevented"]);
const NEEDS_RESPONSE_STATUSES = new Set(["needs_response", "warning_needs_response"]);

/** Order of Stripe's own lifecycle, used only to ignore an older snapshot that arrives late. */
export function stripeDisputeStatusRank(status: string): number {
  switch (status) {
    case "warning_needs_response":
      return 0;
    case "warning_under_review":
      return 1;
    case "needs_response":
      return 2;
    case "under_review":
      return 3;
    default:
      return TERMINAL_STATUSES.has(status) ? 4 : 2;
  }
}

export function isTerminalStripeDisputeStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function isNeedsResponseStripeDisputeStatus(status: string): boolean {
  return NEEDS_RESPONSE_STATUSES.has(status);
}

// ---------- Stripe access (one seam for tests: the SDK host is pointed at a fake server) ----------

export async function retrieveStripeDispute(
  disputeId: string,
  stripeAccount?: string | null,
): Promise<Stripe.Dispute> {
  return getStripeClient().disputes.retrieve(
    disputeId,
    { expand: ["charge"] },
    stripeAccount ? { stripeAccount } : undefined,
  );
}

const idOf = (v: unknown): string | null =>
  typeof v === "string" ? v : v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string"
    ? (v as { id: string }).id
    : null;

export type DisputeFunds = {
  withdrawnCents: number;
  reinstatedCents: number;
  feeCents: number;
  count: number;
  /** Currency of the balance transactions (CareTip's platform balance), not necessarily the dispute's. */
  currency: string | null;
  /** More than one currency: totals cover `currency` only and the dispute needs reconciliation. */
  mixedCurrency: boolean;
};

/**
 * Stripe's dispute balance transactions: negative amounts were withdrawn from CareTip's platform
 * balance, positive ones reinstated. Amounts are only ever added within one currency.
 */
export function summarizeDisputeFunds(dispute: Pick<Stripe.Dispute, "balance_transactions">): DisputeFunds {
  let withdrawnCents = 0;
  let reinstatedCents = 0;
  let feeCents = 0;
  const rows = Array.isArray(dispute.balance_transactions) ? dispute.balance_transactions : [];
  const norm = (c: unknown) => String(c ?? "").toLowerCase();
  const currency = rows.length ? norm(rows[0]!.currency) : "";
  let mixedCurrency = false;
  for (const bt of rows) {
    if (norm(bt.currency) !== currency) {
      mixedCurrency = true;
      continue;
    }
    const amount = typeof bt.amount === "number" ? bt.amount : 0;
    if (amount < 0) withdrawnCents += -amount;
    else reinstatedCents += amount;
    feeCents += typeof bt.fee === "number" ? bt.fee : 0;
  }
  return { withdrawnCents, reinstatedCents, feeCents, count: rows.length, currency: currency || null, mixedCurrency };
}

// ---------- classification from verified Stripe references only ----------

type Classification = {
  subjectKind: StripeDisputeSubjectKind;
  businessId: string | null;
  employeeId: string | null;
  transactionId: string | null;
  physicalQrOrderId: string | null;
  subscriptionId: string | null;
  note: string | null;
};

const UNATTRIBUTED: Classification = {
  subjectKind: StripeDisputeSubjectKind.unattributed,
  businessId: null,
  employeeId: null,
  transactionId: null,
  physicalQrOrderId: null,
  subscriptionId: null,
  note: null,
};

/**
 * PaymentIntent → tip or QR order; customer + invoice → subscription. A tip is a destination charge only
 * when Stripe's transfer_data.destination is the tip business's or the tipped employee's own account.
 * Never matched by email or by client-supplied metadata.
 */
export async function classifyDispute(charge: Stripe.Charge | null, paymentIntentId: string | null): Promise<Classification> {
  if (paymentIntentId) {
    const tip = await prisma.transaction.findUnique({
      where: { stripePaymentIntentId: paymentIntentId },
      select: { id: true, businessId: true, employeeId: true, business: { select: { stripeAccountId: true } } },
    });
    if (tip) {
      const base = { ...UNATTRIBUTED, businessId: tip.businessId, employeeId: tip.employeeId, transactionId: tip.id };
      const destination = idOf(charge?.transfer_data?.destination ?? null);
      if (!destination) {
        return { ...base, subjectKind: StripeDisputeSubjectKind.tip_platform_hold };
      }
      if (tip.business.stripeAccountId && destination === tip.business.stripeAccountId) {
        return { ...base, subjectKind: StripeDisputeSubjectKind.tip_destination_business };
      }
      if (tip.employeeId) {
        const employeeAccount = await prisma.employeeStripeAccount.findUnique({
          where: { employeeId: tip.employeeId },
          select: { stripeAccountId: true },
        });
        if (employeeAccount?.stripeAccountId === destination) {
          return { ...base, subjectKind: StripeDisputeSubjectKind.tip_destination_employee };
        }
      }
      // A destination that is neither of them: keep the tip link, but never act on it automatically.
      return { ...base, subjectKind: StripeDisputeSubjectKind.unattributed, note: "destination_account_mismatch" };
    }
    const order = await prisma.physicalQrOrder.findFirst({
      where: { stripePaymentIntentId: paymentIntentId },
      select: { id: true, businessId: true },
    });
    if (order) {
      return {
        ...UNATTRIBUTED,
        subjectKind: StripeDisputeSubjectKind.physical_qr_order,
        businessId: order.businessId,
        physicalQrOrderId: order.id,
      };
    }
  }
  const customerId = idOf(charge?.customer ?? null);
  const invoiceId = idOf((charge as (Stripe.Charge & { invoice?: unknown }) | null)?.invoice ?? null);
  if (customerId && invoiceId) {
    const subscription = await prisma.subscription.findFirst({
      where: { stripeCustomerId: customerId },
      select: { id: true, businessId: true },
    });
    const business = subscription
      ? null
      : await prisma.business.findFirst({ where: { stripeCustomerId: customerId }, select: { id: true } });
    if (subscription || business) {
      return {
        ...UNATTRIBUTED,
        subjectKind: StripeDisputeSubjectKind.subscription,
        businessId: subscription?.businessId ?? business!.id,
        subscriptionId: subscription?.id ?? null,
      };
    }
  }
  return UNATTRIBUTED;
}

// ---------- recovery status (CareTip operational state derived from Stripe outcome) ----------

export function isRecoverableSubject(kind: StripeDisputeSubjectKind): boolean {
  return (
    kind === StripeDisputeSubjectKind.tip_destination_business ||
    kind === StripeDisputeSubjectKind.tip_destination_employee ||
    kind === StripeDisputeSubjectKind.tip_platform_hold
  );
}

export function deriveRecoveryStatus(args: {
  stripeStatus: string;
  subjectKind: StripeDisputeSubjectKind;
  previous: StripeDisputeRecoveryStatus | null;
  recoveredCents: number;
  /** Released to the employee before the loss; 0 = still held by CareTip, nothing to recover. */
  platformHoldTransferredCents?: number;
}): StripeDisputeRecoveryStatus {
  const { stripeStatus, subjectKind, previous } = args;
  if (
    subjectKind === StripeDisputeSubjectKind.physical_qr_order ||
    subjectKind === StripeDisputeSubjectKind.subscription
  ) {
    return StripeDisputeRecoveryStatus.not_applicable; // CareTip's own sale: no beneficiary to recover from
  }
  if (stripeStatus !== "lost") {
    if (previous === StripeDisputeRecoveryStatus.cancelled) return previous;
    if (isTerminalStripeDisputeStatus(stripeStatus)) return StripeDisputeRecoveryStatus.not_required;
    return StripeDisputeRecoveryStatus.not_applicable;
  }
  // Still held by CareTip (never paid out to the employee): nothing to recover.
  if (subjectKind === StripeDisputeSubjectKind.tip_platform_hold && (args.platformHoldTransferredCents ?? 0) === 0) {
    return StripeDisputeRecoveryStatus.not_required;
  }
  if (subjectKind === StripeDisputeSubjectKind.unattributed) return StripeDisputeRecoveryStatus.review_required;
  // Lost tip dispute (destination or platform hold): keep the recovery service's state; never mark money
  // recovered here. Recovery itself is admin-approved only.
  if (
    previous === StripeDisputeRecoveryStatus.recovered ||
    previous === StripeDisputeRecoveryStatus.partially_recovered ||
    previous === StripeDisputeRecoveryStatus.in_progress ||
    previous === StripeDisputeRecoveryStatus.outstanding ||
    previous === StripeDisputeRecoveryStatus.cancelled ||
    previous === StripeDisputeRecoveryStatus.failed
  ) {
    return previous;
  }
  return args.recoveredCents > 0 ? StripeDisputeRecoveryStatus.partially_recovered : StripeDisputeRecoveryStatus.review_required;
}

// ---------- sync ----------

type StoredHead = {
  id: string;
  stripe_status: string;
  balance_transaction_count: number;
  evidence_submission_count: number;
  recovery_status: StripeDisputeRecoveryStatus;
  recovered_cents: number;
};

function isOlderSnapshot(stored: StoredHead, incoming: { status: string; btCount: number; submissions: number }): boolean {
  if (stripeDisputeStatusRank(incoming.status) < stripeDisputeStatusRank(stored.stripe_status)) return true;
  if (incoming.btCount < stored.balance_transaction_count) return true;
  if (incoming.submissions < stored.evidence_submission_count) return true;
  return false;
}

/** Records a failed Stripe read on an existing row (the caller still rethrows so the event is retried). */
async function recordSyncError(stripeDisputeId: string, err: unknown): Promise<void> {
  const message = (err instanceof Error ? err.message : String(err)).replace(/sk_(live|test)_[A-Za-z0-9]+/g, "sk_***").slice(0, 300);
  await prisma.stripeDispute
    .updateMany({ where: { stripeDisputeId }, data: { lastSyncError: message, lastSyncErrorAt: new Date() } })
    .catch(() => undefined);
}

/**
 * Re-reads the dispute from Stripe and applies it. Throws when Stripe cannot be read, so a webhook is
 * answered 500 and retried by Stripe, and reconciliation records the error and tries again later.
 */
export async function syncStripeDisputeFromStripe(
  stripeDisputeId: string,
  ctx: DisputeSyncContext,
): Promise<DisputeSyncResult> {
  const id = stripeDisputeId.trim();
  if (!/^(dp|du)_[A-Za-z0-9]+$/.test(id)) throw new Error("invalid_stripe_dispute_id");
  return runSerializedByKey(`stripe_dispute_sync:${id}`, () => syncOnce(id, ctx));
}

async function syncOnce(id: string, ctx: DisputeSyncContext): Promise<DisputeSyncResult> {
  let dispute: Stripe.Dispute;
  try {
    dispute = await retrieveStripeDispute(id, ctx.stripeEventAccount);
  } catch (err) {
    await recordSyncError(id, err);
    logServerError("stripeDispute.retrieve", err, { stripeDisputeId: id, source: ctx.source });
    throw err;
  }
  const charge = dispute.charge && typeof dispute.charge === "object" ? (dispute.charge as Stripe.Charge) : null;
  const chargeId = idOf(dispute.charge);
  const paymentIntentId = idOf(dispute.payment_intent) ?? idOf(charge?.payment_intent ?? null);
  const funds = summarizeDisputeFunds(dispute);
  const classification = await classifyDispute(charge, paymentIntentId);
  const evidence = dispute.evidence_details;
  const now = new Date();

  const payableFor = async () =>
    classification.subjectKind === StripeDisputeSubjectKind.tip_platform_hold && classification.transactionId
      ? prisma.employeeTipPayable.findUnique({
          where: { transactionId: classification.transactionId },
          select: { reversedCents: true, transferredCents: true },
        })
      : null;
  const payableBefore = await payableFor();
  const platformHoldTransferredCents = payableBefore?.transferredCents ?? 0;

  const authoritative = {
    livemode: dispute.livemode === true,
    stripeStatus: dispute.status,
    stripeReason: typeof dispute.reason === "string" ? dispute.reason.slice(0, 64) : null,
    amountCents: dispute.amount,
    currency: String(dispute.currency ?? "eur").toLowerCase().slice(0, 8),
    stripeChargeId: chargeId,
    stripePaymentIntentId: paymentIntentId,
    // D4: only a read made in a connected account's context sets this; a read without it never clears it.
    ...(ctx.stripeEventAccount ? { stripeEventAccountId: ctx.stripeEventAccount } : {}),
    chargeAmountCents: charge?.amount ?? null,
    chargeAmountRefundedCents: charge?.amount_refunded ?? null,
    isChargeRefundable: typeof dispute.is_charge_refundable === "boolean" ? dispute.is_charge_refundable : null,
    destinationAccountId: idOf(charge?.transfer_data?.destination ?? null),
    destinationTransferId: idOf(charge?.transfer ?? null),
    applicationFeeCents: typeof charge?.application_fee_amount === "number" ? charge.application_fee_amount : null,
    evidenceDueBy: evidence?.due_by ? new Date(evidence.due_by * 1000) : null,
    evidenceHasEvidence: evidence?.has_evidence === true,
    evidencePastDue: evidence?.past_due === true,
    evidenceSubmissionCount: typeof evidence?.submission_count === "number" ? evidence.submission_count : 0,
    fundsWithdrawnCents: funds.withdrawnCents,
    fundsReinstatedCents: funds.reinstatedCents,
    disputeFeeCents: funds.feeCents,
    balanceTransactionCount: funds.count,
    fundsCurrency: funds.currency,
    fundsCurrencyMixed: funds.mixedCurrency,
    stripeCreatedAt: new Date((dispute.created ?? Math.floor(Date.now() / 1000)) * 1000),
    lastStripeSyncAt: now,
    lastSyncError: null,
    lastSyncErrorAt: null,
    ...(ctx.stripeEventId ? { lastStripeEventId: ctx.stripeEventId } : {}),
    ...(ctx.stripeEventType ? { lastStripeEventType: ctx.stripeEventType.slice(0, 64) } : {}),
  };

  const write = async (): Promise<{ result: DisputeSyncResult; previousStatus: string | null; previousReinstated: number }> =>
    prisma.$transaction(async (tx) => {
      const [stored] = await tx.$queryRaw<(StoredHead & { funds_reinstated_cents: number })[]>`
        SELECT id, stripe_status, balance_transaction_count, evidence_submission_count, recovery_status,
               recovered_cents, funds_reinstated_cents
        FROM stripe_disputes WHERE stripe_dispute_id = ${id} FOR UPDATE`;
      const incoming = {
        status: dispute.status,
        btCount: funds.count,
        submissions: authoritative.evidenceSubmissionCount,
      };
      if (stored && isOlderSnapshot(stored, incoming)) {
        return {
          result: { outcome: "stale_ignored" as const, disputeRowId: stored.id, stripeStatus: stored.stripe_status },
          previousStatus: stored.stripe_status,
          previousReinstated: stored.funds_reinstated_cents,
        };
      }
      const recoveryStatus = deriveRecoveryStatus({
        stripeStatus: dispute.status,
        subjectKind: classification.subjectKind,
        previous: stored?.recovery_status ?? null,
        recoveredCents: stored?.recovered_cents ?? 0,
        platformHoldTransferredCents,
      });
      const links = {
        subjectKind: classification.subjectKind,
        businessId: classification.businessId,
        employeeId: classification.employeeId,
        transactionId: classification.transactionId,
        physicalQrOrderId: classification.physicalQrOrderId,
        subscriptionId: classification.subscriptionId,
      };
      if (!stored) {
        const row = await tx.stripeDispute.create({
          data: {
            stripeDisputeId: id,
            ...authoritative,
            ...links,
            recoveryStatus,
            recoveryNote: classification.note,
          },
          select: { id: true },
        });
        return {
          result: { outcome: "created" as const, disputeRowId: row.id, stripeStatus: dispute.status },
          previousStatus: null,
          previousReinstated: 0,
        };
      }
      const changed =
        stored.stripe_status !== dispute.status ||
        stored.balance_transaction_count !== funds.count ||
        stored.evidence_submission_count !== authoritative.evidenceSubmissionCount;
      await tx.stripeDispute.update({
        where: { id: stored.id },
        data: {
          ...authoritative,
          ...links,
          recoveryStatus,
          ...(classification.note ? { recoveryNote: classification.note } : {}),
        },
      });
      if (changed) {
        await tx.auditLog.create({
          data: {
            action: "stripe_dispute.state_synced",
            metadata: JSON.stringify({
              stripeDisputeId: id,
              from: stored.stripe_status,
              to: dispute.status,
              balanceTransactions: funds.count,
              submissions: authoritative.evidenceSubmissionCount,
              source: ctx.source,
              stripeEventId: ctx.stripeEventId ?? null,
            }),
          },
        });
      }
      return {
        result: { outcome: changed ? ("updated" as const) : ("unchanged" as const), disputeRowId: stored.id, stripeStatus: dispute.status },
        previousStatus: stored.stripe_status,
        previousReinstated: stored.funds_reinstated_cents,
      };
    });

  let written: Awaited<ReturnType<typeof write>>;
  try {
    written = await write();
  } catch (err) {
    // Two first syncs of the same dispute on different instances: the second sees the row on retry.
    if ((err as { code?: unknown })?.code !== "P2002") throw err;
    written = await write();
  }
  if (written.result.outcome === "stale_ignored") {
    console.info("[stripe.dispute] older Stripe snapshot ignored", { stripeDisputeId: id, source: ctx.source });
    return written.result;
  }

  // Existing ledgers (tip refunds, employee payables incl. platform-hold reversal, QR adjustments), fed
  // with Stripe's current state instead of the event body.
  const { upsertStripeDisputeEvent } = await import("../finance/tipRefunds.service.js");
  await upsertStripeDisputeEvent({
    stripeDisputeId: id,
    stripeChargeId: chargeId,
    stripePaymentIntentId: paymentIntentId,
    amountCents: dispute.amount,
    currency: dispute.currency,
    status: dispute.status,
    reason: typeof dispute.reason === "string" ? dispute.reason : null,
    occurredAt: authoritative.stripeCreatedAt,
    stripeEventAccount: ctx.stripeEventAccount ?? null,
  });

  // An approved recovery stops as soon as Stripe says nothing is owed (won, or funds reinstated).
  if (dispute.status !== "lost" || funds.reinstatedCents > written.previousReinstated) {
    const { cancelRecoveryForOutcome } = await import("./stripeDisputeRecovery.service.js");
    await cancelRecoveryForOutcome(
      written.result.disputeRowId,
      dispute.status !== "lost" ? `dispute_${dispute.status}` : "funds_reinstated",
    );
  }

  await notifyForTransition(written.result.disputeRowId, {
    previousStatus: written.previousStatus,
    status: dispute.status,
    previousReinstatedCents: written.previousReinstated,
    reinstatedCents: funds.reinstatedCents,
  });
  return written.result;
}

async function notifyForTransition(
  rowId: string,
  t: { previousStatus: string | null; status: string; previousReinstatedCents: number; reinstatedCents: number },
): Promise<void> {
  try {
    if (t.previousStatus === null) await notifyStripeDisputeEvent(rowId, "opened");
    if (t.status === "lost" && t.previousStatus !== "lost") await notifyStripeDisputeEvent(rowId, "lost");
    if (t.status === "won" && t.previousStatus !== "won") await notifyStripeDisputeEvent(rowId, "won");
    if (t.reinstatedCents > t.previousReinstatedCents) await notifyStripeDisputeEvent(rowId, "funds_reinstated");
  } catch (err) {
    logServerError("stripeDispute.notify", err, { rowId });
  }
}

export type { Prisma };
