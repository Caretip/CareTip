/**
 * QR print order refunds and disputes (Stripe is the source of truth).
 *
 * Each refund/dispute is one `physical_qr_payment_adjustments` row (unique Stripe id). After every
 * write the order's payment status is recomputed from all its adjustments under the order row lock,
 * so replays and out-of-order deliveries cannot double-count or regress it:
 *   open dispute or lost dispute → DISPUTED
 *   succeeded refunds ≥ amount paid → REFUNDED
 *   some succeeded refund        → PARTIALLY_REFUNDED
 *   otherwise                    → the order's base paid state (PAID, or IN_REVIEW for an order that
 *                                  was never accepted for fulfillment)
 * Fulfillment status is never rewritten here (order history is preserved); print/fulfillment paths
 * only proceed for paymentStatus === "PAID", so refunded or disputed orders stop there.
 */
import type { Prisma, PhysicalQrPaymentStatus } from "@prisma/client";
import { prisma } from "../../prisma.js";
import { recordPaymentDiscrepancy, resolvePaymentDiscrepanciesForSubject } from "../payments/paymentDiscrepancy.service.js";

const PAID_FAMILY: PhysicalQrPaymentStatus[] = ["PAID", "PARTIALLY_REFUNDED", "REFUNDED", "DISPUTED", "IN_REVIEW"];

export function isPhysicalQrPaidFamilyStatus(status: string): boolean {
  return (PAID_FAMILY as string[]).includes(status);
}

type RefundEventInput = {
  stripeRefundId: string;
  stripePaymentIntentId?: string | null;
  stripeChargeId?: string | null;
  amountCents: number;
  currency?: string;
  status: string;
  reason?: string | null;
  occurredAt: Date;
};

type DisputeEventInput = {
  stripeDisputeId: string;
  stripeChargeId?: string | null;
  stripePaymentIntentId?: string | null;
  amountCents: number;
  currency?: string;
  status: string;
  reason?: string | null;
  occurredAt: Date;
};

function normalizeRefundStatus(raw: string): "pending" | "succeeded" | "failed" | "canceled" {
  const s = String(raw).toLowerCase();
  if (s === "succeeded") return "succeeded";
  if (s === "failed") return "failed";
  if (s === "canceled" || s === "cancelled") return "canceled";
  return "pending";
}

/** Same lifecycle rule as tip refunds: forward only; succeeded may still become failed. */
export function isAllowedQrRefundTransition(from: string, to: string): boolean {
  if (from === to) return true;
  if (from === "pending") return true;
  if (from === "succeeded") return to === "failed";
  return false;
}

const DISPUTE_TERMINAL = new Set(["won", "lost", "warning_closed", "charge_refunded"]);

function isDisputeOpenStatus(status: string): boolean {
  return !DISPUTE_TERMINAL.has(status);
}

function isDisputeLostStatus(status: string): boolean {
  return status === "lost" || status === "charge_refunded";
}

/** A terminal dispute outcome is never replaced by a late non-terminal event. */
export function mergeQrDisputeStatus(previous: string | undefined, incoming: string): string {
  if (previous && DISPUTE_TERMINAL.has(previous) && !DISPUTE_TERMINAL.has(incoming)) return previous;
  return incoming;
}

async function findOrderForPayment(paymentIntentId: string | null | undefined) {
  const pi = paymentIntentId?.trim();
  if (!pi) return null;
  return prisma.physicalQrOrder.findFirst({
    where: { stripePaymentIntentId: pi },
    select: { id: true, businessId: true },
  });
}

/** Recomputes payment status from adjustments. Runs inside the caller's transaction (order row locked). */
export async function recomputePhysicalQrOrderPaymentState(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<{ from: string; to: string; disputeWonNeedsReview?: boolean } | null> {
  const order = await tx.physicalQrOrder.findUnique({
    where: { id: orderId },
    select: {
      paymentStatus: true,
      fulfillmentStatus: true,
      totalAmount: true,
      paidAt: true,
      holdReleasedAt: true,
      holdReleaseRefundedCents: true,
    },
  });
  if (!order || !isPhysicalQrPaidFamilyStatus(order.paymentStatus)) return null;

  const adjustments = await tx.physicalQrPaymentAdjustment.findMany({
    where: { orderId },
    select: { kind: true, status: true, amountCents: true },
  });
  const refunded = adjustments
    .filter((a) => a.kind === "refund" && a.status === "succeeded")
    .reduce((sum, a) => sum + a.amountCents, 0);
  const disputes = adjustments.filter((a) => a.kind === "dispute");
  const disputed = disputes.some((d) => isDisputeOpenStatus(d.status) || isDisputeLostStatus(d.status));
  const wonDispute = !disputed && disputes.length > 0;

  // A platform-admin release covers exactly the payment state it was decided on (refunded total,
  // no open/lost dispute). Any change — another refund, a new dispute — invalidates it.
  const releaseStillValid = order.holdReleasedAt != null && !disputed && order.holdReleaseRefundedCents === refunded;

  // Never accepted for fulfillment (fulfillment still waiting for payment) → base is IN_REVIEW.
  const base: PhysicalQrPaymentStatus =
    order.fulfillmentStatus === "PENDING_PAYMENT" || order.fulfillmentStatus === "PAYMENT_FAILED"
      ? "IN_REVIEW"
      : "PAID";
  let next: PhysicalQrPaymentStatus = base;
  let disputeWonNeedsReview = false;
  if (disputed) next = "DISPUTED";
  else if (order.totalAmount > 0 && refunded >= order.totalAmount) next = "REFUNDED";
  else if (refunded > 0) next = "PARTIALLY_REFUNDED";
  else if (wonDispute && !releaseStillValid) {
    // A won dispute is not an automatic release: the payment must be re-verified by a platform
    // admin first (physicalQrHoldResolution.service.ts).
    next = "IN_REVIEW";
    disputeWonNeedsReview = true;
  }
  if (wonDispute && !releaseStillValid && next === "PARTIALLY_REFUNDED") disputeWonNeedsReview = true;

  const keepRelease = releaseStillValid && (next === "PARTIALLY_REFUNDED" || next === "PAID");
  const clearRelease = order.holdReleasedAt != null && !keepRelease;

  if (next === order.paymentStatus && !clearRelease) return disputeWonNeedsReview ? { from: next, to: next, disputeWonNeedsReview } : null;
  await tx.physicalQrOrder.update({
    where: { id: orderId },
    data: {
      paymentStatus: next,
      ...(clearRelease ? { holdReleasedAt: null, holdReleasedByUserId: null, holdReleaseRefundedCents: null } : {}),
    },
  });
  return { from: order.paymentStatus, to: next, disputeWonNeedsReview };
}

async function withLockedOrder<T>(orderId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM physical_qr_orders WHERE id = ${orderId} FOR UPDATE`;
      return fn(tx);
    },
    { timeout: 20_000, maxWait: 10_000 },
  );
}

/** Returns true when the refund belongs to a QR print order (and was handled). */
export async function applyPhysicalQrRefundEvent(input: RefundEventInput): Promise<boolean> {
  const order = await findOrderForPayment(input.stripePaymentIntentId);
  if (!order) return false;
  const status = normalizeRefundStatus(input.status);

  const change = await withLockedOrder(order.id, async (tx) => {
    const previous = await tx.physicalQrPaymentAdjustment.findUnique({
      where: { stripeRefundId: input.stripeRefundId },
      select: { status: true },
    });
    if (previous && !isAllowedQrRefundTransition(previous.status, status)) {
      console.info("[physicalQr.refund] stale refund status ignored", {
        stripeRefundId: input.stripeRefundId,
        stored: previous.status,
        incoming: status,
      });
      return null;
    }
    await tx.physicalQrPaymentAdjustment.upsert({
      where: { stripeRefundId: input.stripeRefundId },
      create: {
        orderId: order.id,
        businessId: order.businessId,
        kind: "refund",
        stripeRefundId: input.stripeRefundId,
        stripePaymentIntentId: input.stripePaymentIntentId ?? null,
        stripeChargeId: input.stripeChargeId ?? null,
        status,
        amountCents: input.amountCents,
        currency: (input.currency ?? "eur").toLowerCase().slice(0, 3),
        reason: input.reason?.slice(0, 120) ?? null,
        occurredAt: input.occurredAt,
      },
      update: {
        status,
        amountCents: input.amountCents,
        stripeChargeId: input.stripeChargeId ?? undefined,
        reason: input.reason?.slice(0, 120) ?? undefined,
      },
    });
    return recomputePhysicalQrOrderPaymentState(tx, order.id);
  });
  if (change) {
    console.info("[physicalQr.refund] payment status changed", { orderId: order.id, ...change });
  }
  return true;
}

/** Returns true when the dispute belongs to a QR print order (and was handled). */
export async function applyPhysicalQrDisputeEvent(input: DisputeEventInput): Promise<boolean> {
  const order = await findOrderForPayment(input.stripePaymentIntentId);
  if (!order) return false;
  const incoming = String(input.status).toLowerCase();

  const change = await withLockedOrder(order.id, async (tx) => {
    const previous = await tx.physicalQrPaymentAdjustment.findUnique({
      where: { stripeDisputeId: input.stripeDisputeId },
      select: { status: true },
    });
    const status = mergeQrDisputeStatus(previous?.status, incoming);
    await tx.physicalQrPaymentAdjustment.upsert({
      where: { stripeDisputeId: input.stripeDisputeId },
      create: {
        orderId: order.id,
        businessId: order.businessId,
        kind: "dispute",
        stripeDisputeId: input.stripeDisputeId,
        stripePaymentIntentId: input.stripePaymentIntentId ?? null,
        stripeChargeId: input.stripeChargeId ?? null,
        status,
        amountCents: input.amountCents,
        currency: (input.currency ?? "eur").toLowerCase().slice(0, 3),
        reason: input.reason?.slice(0, 120) ?? null,
        occurredAt: input.occurredAt,
      },
      update: {
        status,
        amountCents: input.amountCents,
        stripeChargeId: input.stripeChargeId ?? undefined,
        reason: input.reason?.slice(0, 120) ?? undefined,
      },
    });
    return recomputePhysicalQrOrderPaymentState(tx, order.id);
  });
  if (change?.disputeWonNeedsReview) {
    await recordPaymentDiscrepancy({
      workflow: "qr_order",
      kind: "dispute_won_needs_review",
      subjectKey: `qr_order:${order.id}`,
      businessId: order.businessId,
      physicalQrOrderId: order.id,
      stripePaymentIntentId: input.stripePaymentIntentId ?? null,
      details: { stripeDisputeId: input.stripeDisputeId, status: incoming },
    });
  }
  if (change && change.to !== "DISPUTED") {
    // The dispute is no longer open or lost: that finding is answered (a won dispute is reviewed via
    // "dispute_won_needs_review" instead).
    await resolvePaymentDiscrepanciesForSubject({
      workflow: "qr_order",
      subjectKey: `qr_order:${order.id}`,
      stillPresentKinds: [],
      onlyKinds: ["order_disputed"],
    });
  }
  if (change?.to === "DISPUTED") {
    await recordPaymentDiscrepancy({
      workflow: "qr_order",
      kind: "order_disputed",
      subjectKey: `qr_order:${order.id}`,
      businessId: order.businessId,
      physicalQrOrderId: order.id,
      stripePaymentIntentId: input.stripePaymentIntentId ?? null,
      details: { stripeDisputeId: input.stripeDisputeId, status: incoming },
    });
  }
  return true;
}
