/**
 * Durable refunds that CareTip initiates itself (ineligible tip after capture, duplicate QR payment).
 *
 * A refund is first persisted as a `stripe_refund_operations` row keyed by its financial intent,
 * then attempted. Failures are classified:
 * - permanent (Stripe rejected the request): stop, alert, record a discrepancy;
 * - transient (rate limit, auth/config, idempotency key in use): retry with backoff;
 * - ambiguous (network/5xx — Stripe may have executed it): retry with the SAME idempotency key, which
 *   Stripe deduplicates for 24h; after that, look the refund up before ever using a new key.
 * Retries are bounded; an exhausted operation becomes `failed_permanent` and is surfaced for review.
 * Concurrent runners (several instances) claim an attempt with a conditional update.
 */
import type Stripe from "stripe";
import { Prisma, StripeRefundOperationStatus } from "@prisma/client";
import { prisma } from "../../prisma.js";
import { captureServerException } from "../../instrument/sentry.js";
import { logServerError } from "../../utils/httpErrors.js";
import {
  createStripeRefund,
  listStripeRefundsForPaymentIntent,
  retrievePaymentIntentAuthoritative,
  tipRefundDestinationFlags,
} from "../stripe.service.js";
import { recordPaymentDiscrepancy, resolvePaymentDiscrepanciesForSubject } from "./paymentDiscrepancy.service.js";

export const REFUND_OPERATION_MAX_ATTEMPTS = 8;
/** An attempt claim lasts this long; a crashed attempt becomes due again afterwards. */
const ATTEMPT_CLAIM_MS = 2 * 60_000;
/** Stripe keeps idempotency keys for 24h. Before then a repeat with the same key is always safe. */
const IDEMPOTENCY_KEY_SAFE_MS = 23 * 60 * 60_000;

export type RefundOperationPurpose = "tip_eligibility" | "qr_duplicate_payment";

export type RequestRefundOperationInput = {
  operationKey: string;
  purpose: RefundOperationPurpose;
  paymentIntentId: string;
  amountCents?: number | null;
  businessId?: string | null;
  transactionId?: string | null;
  physicalQrOrderId?: string | null;
  /** Metadata + follow-up data for `onRefundOperationSucceeded`. */
  context?: Record<string, unknown>;
};

export type RefundOperationResult = {
  operationId: string;
  status: StripeRefundOperationStatus;
  stripeRefundId: string | null;
};

type RefundErrorKind = "permanent" | "transient" | "ambiguous" | "already_refunded";

export function classifyStripeRefundError(err: unknown): { kind: RefundErrorKind; code: string | null; message: string } {
  const e = err as { type?: string; code?: string; statusCode?: number; message?: string } | null;
  const type = e?.type ?? "";
  const code = e?.code ?? null;
  const message = (e?.message ?? String(err)).slice(0, 500);
  if (code === "charge_already_refunded") return { kind: "already_refunded", code, message };
  if (type === "StripeConnectionError" || type === "StripeAPIError") return { kind: "ambiguous", code, message };
  if (typeof e?.statusCode === "number" && e.statusCode >= 500) return { kind: "ambiguous", code, message };
  if (
    type === "StripeRateLimitError" ||
    type === "StripeIdempotencyError" ||
    type === "StripeAuthenticationError" ||
    type === "StripePermissionError" ||
    e?.statusCode === 409 ||
    e?.statusCode === 429
  ) {
    return { kind: "transient", code, message };
  }
  if (type === "StripeInvalidRequestError" || type === "StripeCardError") return { kind: "permanent", code, message };
  // Not a Stripe API error (timeout, DNS, socket): the request may have reached Stripe.
  return { kind: "ambiguous", code, message };
}

export function refundOperationBackoffMs(attempts: number): number {
  return Math.min(6 * 60 * 60_000, 60_000 * 2 ** Math.max(0, attempts - 1));
}

function idempotencyKeyFor(op: { operationKey: string; keyGeneration: number }): string {
  // Generation 0 keeps the historical key (e.g. "eligibility_refund:pi_…") so an in-flight retry
  // from before this change is still deduplicated by Stripe.
  return op.keyGeneration === 0 ? op.operationKey : `${op.operationKey}:g${op.keyGeneration}`;
}

/** Creates the operation once (by key) and attempts it immediately. Safe to call repeatedly. */
export async function requestRefundOperation(input: RequestRefundOperationInput): Promise<RefundOperationResult> {
  let op = await prisma.stripeRefundOperation.findUnique({ where: { operationKey: input.operationKey } });
  if (!op) {
    try {
      op = await prisma.stripeRefundOperation.create({
        data: {
          operationKey: input.operationKey,
          purpose: input.purpose,
          stripePaymentIntentId: input.paymentIntentId,
          amountCents: input.amountCents ?? null,
          businessId: input.businessId ?? null,
          transactionId: input.transactionId ?? null,
          physicalQrOrderId: input.physicalQrOrderId ?? null,
          context: (input.context ?? {}) as Prisma.InputJsonValue,
          nextAttemptAt: new Date(),
        },
      });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
      op = await prisma.stripeRefundOperation.findUniqueOrThrow({ where: { operationKey: input.operationKey } });
    }
  }
  if (op.status === StripeRefundOperationStatus.pending) {
    await executeRefundOperation(op.id);
    op = await prisma.stripeRefundOperation.findUniqueOrThrow({ where: { id: op.id } });
  }
  return { operationId: op.id, status: op.status, stripeRefundId: op.stripeRefundId };
}

/** Claims one attempt; returns null when the operation is not due or another runner holds it. */
async function claimAttempt(operationId: string) {
  const now = new Date();
  const claimed = await prisma.stripeRefundOperation.updateMany({
    where: {
      id: operationId,
      status: StripeRefundOperationStatus.pending,
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    data: { attempts: { increment: 1 }, nextAttemptAt: new Date(now.getTime() + ATTEMPT_CLAIM_MS) },
  });
  if (claimed.count !== 1) return null;
  return prisma.stripeRefundOperation.findUniqueOrThrow({ where: { id: operationId } });
}

function ownedRefund(refunds: Stripe.Refund[], operationId: string): Stripe.Refund | null {
  return (
    refunds.find(
      (r) => r.metadata?.caretip_refund_operation_id === operationId && r.status !== "failed" && r.status !== "canceled",
    ) ?? null
  );
}

async function markSucceeded(operationId: string, refundId: string, note?: string): Promise<void> {
  const updated = await prisma.stripeRefundOperation.updateMany({
    where: { id: operationId, status: StripeRefundOperationStatus.pending },
    data: {
      status: StripeRefundOperationStatus.succeeded,
      stripeRefundId: refundId,
      succeededAt: new Date(),
      nextAttemptAt: null,
      ...(note ? { lastErrorCode: note } : {}),
    },
  });
  if (updated.count === 1) {
    const op = await prisma.stripeRefundOperation.findUniqueOrThrow({ where: { id: operationId } });
    await onRefundOperationSucceeded(op).catch((err) =>
      logServerError("refundOperation.onSucceeded", err, { operationId }),
    );
  }
}

async function markFailedPermanent(
  op: { id: string; purpose: string; stripePaymentIntentId: string; businessId: string | null; transactionId: string | null; physicalQrOrderId: string | null },
  kind: string,
  code: string | null,
  message: string,
): Promise<void> {
  await prisma.stripeRefundOperation.update({
    where: { id: op.id },
    data: {
      status: StripeRefundOperationStatus.failed_permanent,
      nextAttemptAt: null,
      lastErrorKind: kind,
      lastErrorCode: code,
      lastErrorMessage: message,
    },
  });
  captureServerException(new Error("CareTip-initiated refund failed permanently"), {
    operationId: op.id,
    purpose: op.purpose,
    paymentIntentId: op.stripePaymentIntentId,
    errorKind: kind,
    errorCode: code,
  });
  await recordPaymentDiscrepancy({
    workflow: "refund",
    kind: "refund_operation_failed",
    subjectKey: `refund_op:${op.id}`,
    businessId: op.businessId,
    stripePaymentIntentId: op.stripePaymentIntentId,
    transactionId: op.transactionId,
    physicalQrOrderId: op.physicalQrOrderId,
    details: { purpose: op.purpose, errorKind: kind, errorCode: code, message },
    alert: false,
  });
}

/** One attempt (or recovery lookup) for a pending operation. Never throws for Stripe errors. */
export async function executeRefundOperation(operationId: string): Promise<void> {
  const op = await claimAttempt(operationId);
  if (!op) return;

  try {
    // The 24h idempotency window may have passed: never create with a fresh key before checking
    // whether an earlier attempt already refunded.
    if (op.attempts > 1 && Date.now() - op.createdAt.getTime() > IDEMPOTENCY_KEY_SAFE_MS) {
      const refunds = await listStripeRefundsForPaymentIntent(op.stripePaymentIntentId);
      const found = ownedRefund(refunds, op.id);
      if (found) {
        await markSucceeded(op.id, found.id, "found_existing_refund");
        return;
      }
      await prisma.stripeRefundOperation.update({
        where: { id: op.id },
        data: { keyGeneration: { increment: 1 } },
      });
      op.keyGeneration += 1;
    }

    const params: Stripe.RefundCreateParams = {
      payment_intent: op.stripePaymentIntentId,
      ...(op.amountCents != null ? { amount: op.amountCents } : {}),
      metadata: {
        caretip_refund_operation_id: op.id,
        caretip_refund_reason: op.purpose === "tip_eligibility" ? "eligibility_failure" : op.purpose,
        ...(typeof (op.context as Record<string, unknown> | null)?.source === "string"
          ? { caretip_context: String((op.context as Record<string, unknown>).source).slice(0, 120) }
          : {}),
      },
    };
    if (op.purpose === "tip_eligibility") {
      // Resolved at execution time so a Stripe outage at webhook time only delays the refund.
      const pi = await retrievePaymentIntentAuthoritative(op.stripePaymentIntentId);
      Object.assign(params, tipRefundDestinationFlags(pi));
    }

    const refund = await createStripeRefund(params, { idempotencyKey: idempotencyKeyFor(op) });
    console.warn("[refundOperation] refunded", {
      operationId: op.id,
      purpose: op.purpose,
      paymentIntentId: op.stripePaymentIntentId,
      refundId: refund.id,
      status: refund.status,
    });
    await markSucceeded(op.id, refund.id);
  } catch (err) {
    const c = classifyStripeRefundError(err);
    if (c.kind === "already_refunded") {
      const refunds = await listStripeRefundsForPaymentIntent(op.stripePaymentIntentId).catch(() => []);
      const found = ownedRefund(refunds, op.id) ?? refunds.find((r) => r.status === "succeeded") ?? null;
      if (found) {
        await markSucceeded(op.id, found.id, found.metadata?.caretip_refund_operation_id === op.id ? undefined : "already_refunded_elsewhere");
        return;
      }
    }
    logServerError("refundOperation.attempt", err, {
      operationId: op.id,
      purpose: op.purpose,
      attempts: op.attempts,
      errorKind: c.kind,
    });
    if (c.kind === "permanent") {
      await markFailedPermanent(op, c.kind, c.code, c.message);
      return;
    }
    if (op.attempts >= REFUND_OPERATION_MAX_ATTEMPTS) {
      await markFailedPermanent(op, "retries_exhausted", c.code, c.message);
      return;
    }
    await prisma.stripeRefundOperation.update({
      where: { id: op.id },
      data: {
        nextAttemptAt: new Date(Date.now() + refundOperationBackoffMs(op.attempts)),
        lastErrorKind: c.kind,
        lastErrorCode: c.code,
        lastErrorMessage: c.message,
      },
    });
  }
}

/** Scheduled runner: attempts every due pending operation. */
export async function retryDueRefundOperations(limit = 25): Promise<{ attempted: number; succeeded: number; failedPermanent: number; stillPending: number }> {
  const due = await prisma.stripeRefundOperation.findMany({
    where: {
      status: StripeRefundOperationStatus.pending,
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  });
  for (const { id } of due) {
    await executeRefundOperation(id);
  }
  const after = await prisma.stripeRefundOperation.findMany({
    where: { id: { in: due.map((d) => d.id) } },
    select: { status: true },
  });
  return {
    attempted: due.length,
    succeeded: after.filter((r) => r.status === StripeRefundOperationStatus.succeeded).length,
    failedPermanent: after.filter((r) => r.status === StripeRefundOperationStatus.failed_permanent).length,
    stillPending: after.filter((r) => r.status === StripeRefundOperationStatus.pending).length,
  };
}

/** Ledger/activity follow-up once Stripe confirmed the refund. Each step is idempotent. */
async function onRefundOperationSucceeded(op: {
  id: string;
  purpose: string;
  stripePaymentIntentId: string;
  stripeRefundId: string | null;
  businessId: string | null;
  transactionId: string | null;
  physicalQrOrderId: string | null;
  context: Prisma.JsonValue;
}): Promise<void> {
  if (!op.stripeRefundId) return;
  const ctx = (op.context ?? {}) as Record<string, unknown>;
  if (op.purpose === "tip_eligibility" && op.transactionId && op.businessId) {
    const amountEur = Number(ctx.amountEur ?? 0);
    const employeeId = typeof ctx.employeeId === "string" ? ctx.employeeId : null;
    const { schedulePaymentRefundedProjection } = await import("../activity/paymentActivity.projection.js");
    schedulePaymentRefundedProjection({
      paymentIntentId: op.stripePaymentIntentId,
      refundId: op.stripeRefundId,
      transactionId: op.transactionId,
      businessId: op.businessId,
      employeeId,
      amountEur,
      employeeName: typeof ctx.employeeName === "string" ? ctx.employeeName : null,
    });
    const { upsertStripeRefundEvent } = await import("../finance/tipRefunds.service.js");
    await upsertStripeRefundEvent({
      stripeRefundId: op.stripeRefundId,
      stripePaymentIntentId: op.stripePaymentIntentId,
      amountCents: Math.round(amountEur * 100),
      currency: "eur",
      status: "succeeded",
      reason: "eligibility_failure",
      occurredAt: new Date(),
      businessId: op.businessId,
      tipId: op.transactionId,
    });
  }
  if (op.purpose === "qr_duplicate_payment") {
    await resolvePaymentDiscrepanciesForSubject({
      workflow: "qr_order",
      subjectKey: `qr_payment:${op.stripePaymentIntentId}`,
      stillPresentKinds: [],
      status: "auto_repaired",
      onlyKinds: ["duplicate_payment"],
    });
  }
}
