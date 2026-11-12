/**
 * Scheduled Stripe ↔ CareTip payment reconciliation for guest tips and QR print orders.
 * (Subscriptions have their own reconciliation: subscriptionBillingReconciliation.service.ts.)
 *
 * Reads Stripe Checkout Sessions created in a configurable window and compares each with the local
 * record; then checks local paid records the listing did not cover. Every finding is a durable
 * PaymentDiscrepancy (auto-resolved when a later run finds the object consistent).
 *
 * Detection is the default. With repair enabled (PAYMENT_RECONCILIATION_REPAIR=true or
 * `repair: true`), a finding is corrected ONLY by re-running the same handler the webhook uses
 * (handleSuccessfulTipPayment / handlePhysicalQrCheckoutSessionCompleted / refund catch-up), which
 * re-verifies the payment with Stripe and the business/employee attribution before writing anything.
 * Reconciliation never creates a tip, fulfils an order or refunds from a mismatch on its own.
 *
 * One run at a time across instances (database lease).
 */
import type Stripe from "stripe";
import { StripeRefundOperationStatus, TipRefundKind, TipRefundStatus } from "@prisma/client";
import { prisma } from "../../prisma.js";
import { getStripeClient, retrievePaymentIntentAuthoritative } from "../stripe.service.js";
import { PHYSICAL_QR_CHECKOUT_METADATA_SOURCE } from "../../config/physicalQrCheckout.js";
import { tryAcquirePaymentOperationLease, releasePaymentOperationLease } from "../../lib/payments/operationLease.js";
import { recordPaymentDiscrepancy, resolvePaymentDiscrepanciesForSubject } from "./paymentDiscrepancy.service.js";
import { isPhysicalQrPaidFamilyStatus } from "../physicalQr/physicalQrPayments.service.js";

const RUN_LEASE_KEY = "payment_reconciliation";
const RUN_LEASE_TTL_MS = 15 * 60_000;
const DEFAULT_WINDOW_HOURS = 72;
const DEFAULT_MAX_SESSIONS = 1000;
const MAX_REVERSE_LOOKUPS = 200;
/** Records younger than this may still be waiting for their webhook. */
const SETTLE_MS = 15 * 60_000;

export const TIP_RECON_KINDS = [
  "tip_missing",
  "tip_amount_mismatch",
  "tip_currency_mismatch",
  "tip_refund_mismatch",
  "tip_pending_but_paid",
  "failed_tip_not_refunded",
  "tip_recorded_for_unpaid_session",
  "local_tip_without_stripe_payment",
] as const;

export const QR_RECON_KINDS = [
  "paid_session_without_order",
  "paid_session_pending_order",
  "order_amount_mismatch",
  "order_currency_mismatch",
  "order_refund_mismatch",
  "order_dispute_not_recorded",
  "duplicate_payment_unrefunded",
  "order_paid_without_payment",
] as const;

export type PaymentReconciliationSummary = {
  skipped?: "already_running" | "stripe_not_configured";
  windowHours: number;
  repair: boolean;
  sessionsScanned: number;
  truncated: boolean;
  tipsChecked: number;
  qrSessionsChecked: number;
  discrepanciesOpen: number;
  repaired: number;
  errors: number;
};

type SessionsListFn = (createdGte: number, max: number) => Promise<{ sessions: Stripe.Checkout.Session[]; truncated: boolean }>;
let sessionsListFnForTests: SessionsListFn | null = null;
/** Test seam — mocked checkout.sessions.list for reconciliation. */
export function __setReconciliationSessionsListFnForTests(fn: SessionsListFn | null): void {
  sessionsListFnForTests = fn;
}

async function listCheckoutSessions(createdGte: number, max: number) {
  if (sessionsListFnForTests) return sessionsListFnForTests(createdGte, max);
  const stripe = getStripeClient();
  const sessions: Stripe.Checkout.Session[] = [];
  let truncated = false;
  for await (const s of stripe.checkout.sessions.list({
    created: { gte: createdGte },
    limit: 100,
    expand: ["data.payment_intent", "data.payment_intent.latest_charge"],
  })) {
    if (sessions.length >= max) {
      truncated = true;
      break;
    }
    sessions.push(s);
  }
  return { sessions, truncated };
}

function windowHoursFromEnv(): number {
  const raw = Number(process.env.PAYMENT_RECONCILIATION_WINDOW_HOURS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_WINDOW_HOURS;
  return Math.min(720, Math.max(1, Math.floor(raw)));
}

function piOf(session: Stripe.Checkout.Session): { id: string | null; obj: Stripe.PaymentIntent | null } {
  const p = session.payment_intent;
  if (!p) return { id: null, obj: null };
  return typeof p === "string" ? { id: p, obj: null } : { id: p.id, obj: p };
}

function chargeOf(pi: Stripe.PaymentIntent | null): Stripe.Charge | null {
  const c = pi?.latest_charge;
  return c && typeof c === "object" ? (c as Stripe.Charge) : null;
}

type Ctx = { repair: boolean; summary: PaymentReconciliationSummary };

async function recordKinds(params: {
  workflow: "tip" | "qr_order";
  subjectKey: string;
  kinds: Array<{ kind: string; details?: Record<string, unknown> }>;
  allKinds: readonly string[];
  refs: {
    businessId?: string | null;
    stripePaymentIntentId?: string | null;
    stripeCheckoutSessionId?: string | null;
    transactionId?: string | null;
    physicalQrOrderId?: string | null;
  };
  repairedKinds?: string[];
  ctx: Ctx;
}): Promise<void> {
  for (const k of params.kinds) {
    await recordPaymentDiscrepancy({
      workflow: params.workflow,
      kind: k.kind,
      subjectKey: params.subjectKey,
      ...params.refs,
      details: k.details,
    });
  }
  params.ctx.summary.discrepanciesOpen += params.kinds.length;
  if (params.repairedKinds?.length) {
    await resolvePaymentDiscrepanciesForSubject({
      workflow: params.workflow,
      subjectKey: params.subjectKey,
      stillPresentKinds: params.kinds.map((k) => k.kind),
      onlyKinds: params.repairedKinds,
      status: "auto_repaired",
    });
  }
  await resolvePaymentDiscrepanciesForSubject({
    workflow: params.workflow,
    subjectKey: params.subjectKey,
    stillPresentKinds: params.kinds.map((k) => k.kind),
    onlyKinds: [...params.allKinds],
  });
}

async function localSucceededRefundCentsForTip(tipId: string): Promise<number> {
  const sum = await prisma.tipRefund.aggregate({
    where: { tipId, kind: TipRefundKind.refund, status: TipRefundStatus.succeeded },
    _sum: { amountEur: true },
  });
  return Math.round(Number(sum._sum.amountEur ?? 0) * 100);
}

async function reconcileTipSession(session: Stripe.Checkout.Session, ctx: Ctx): Promise<void> {
  const { id: piId, obj: pi } = piOf(session);
  if (!piId) return;
  ctx.summary.tipsChecked += 1;
  const subjectKey = `tip:${piId}`;
  const findTip = () =>
    prisma.transaction.findUnique({
      where: { stripePaymentIntentId: piId },
      select: { id: true, status: true, amount: true, businessId: true },
    });
  let tip = await findTip();
  const kinds: Array<{ kind: string; details?: Record<string, unknown> }> = [];
  const repairedKinds: string[] = [];

  if (session.payment_status !== "paid") {
    if (tip?.status === "success") {
      kinds.push({ kind: "tip_recorded_for_unpaid_session", details: { paymentStatus: session.payment_status } });
    }
  } else {
    if (!tip && ctx.repair) {
      const { handleSuccessfulTipPayment } = await import("../stripe.service.js");
      await handleSuccessfulTipPayment(session);
      tip = await findTip();
      if (tip) {
        repairedKinds.push("tip_missing");
        ctx.summary.repaired += 1;
      }
    }
    if (!tip) {
      kinds.push({ kind: "tip_missing", details: { amountTotal: session.amount_total ?? null, businessId: session.metadata?.businessId ?? null } });
    } else if (tip.status === "pending") {
      kinds.push({ kind: "tip_pending_but_paid" });
    } else if (tip.status === "success") {
      if (typeof session.amount_total === "number" && Math.round(Number(tip.amount) * 100) !== session.amount_total) {
        kinds.push({ kind: "tip_amount_mismatch", details: { local: Number(tip.amount), stripeCents: session.amount_total } });
      }
      if (String(session.currency ?? "").toLowerCase() !== "eur") {
        kinds.push({ kind: "tip_currency_mismatch", details: { currency: session.currency ?? null } });
      }
      const charge = chargeOf(pi);
      if (charge) {
        let local = await localSucceededRefundCentsForTip(tip.id);
        if (local !== charge.amount_refunded && ctx.repair) {
          const { applyExistingStripeRefundsAfterSuccessfulTip } = await import("../finance/tipRefunds.service.js");
          const { listStripeRefundsForPaymentIntent } = await import("../stripe.service.js");
          await applyExistingStripeRefundsAfterSuccessfulTip({
            paymentIntentId: piId,
            listRefunds: () => listStripeRefundsForPaymentIntent(piId),
          });
          local = await localSucceededRefundCentsForTip(tip.id);
          if (local === charge.amount_refunded) {
            repairedKinds.push("tip_refund_mismatch");
            ctx.summary.repaired += 1;
          }
        }
        if (local !== charge.amount_refunded) {
          kinds.push({ kind: "tip_refund_mismatch", details: { localRefundedCents: local, stripeRefundedCents: charge.amount_refunded } });
        }
      }
    } else if (tip.status === "failed") {
      const charge = chargeOf(pi);
      const fullyRefunded = charge ? charge.refunded || charge.amount_refunded >= charge.amount : false;
      if (!fullyRefunded) {
        const op = await prisma.stripeRefundOperation.findFirst({
          where: { stripePaymentIntentId: piId },
          select: { status: true },
        });
        if (!op || op.status === StripeRefundOperationStatus.failed_permanent) {
          kinds.push({ kind: "failed_tip_not_refunded", details: { refundOperation: op?.status ?? null } });
        }
      }
    }
  }

  await recordKinds({
    workflow: "tip",
    subjectKey,
    kinds,
    allKinds: TIP_RECON_KINDS,
    refs: {
      businessId: tip?.businessId ?? session.metadata?.businessId ?? null,
      stripePaymentIntentId: piId,
      stripeCheckoutSessionId: session.id,
      transactionId: tip?.id ?? null,
    },
    repairedKinds,
    ctx,
  });
}

async function localQrAdjustmentTotals(orderId: string) {
  const rows = await prisma.physicalQrPaymentAdjustment.findMany({
    where: { orderId },
    select: { kind: true, status: true, amountCents: true },
  });
  return {
    refundedCents: rows.filter((r) => r.kind === "refund" && r.status === "succeeded").reduce((s, r) => s + r.amountCents, 0),
    disputes: rows.filter((r) => r.kind === "dispute").length,
  };
}

async function reconcileQrSession(session: Stripe.Checkout.Session, ctx: Ctx, paidSessionsByOrder: Map<string, string[]>): Promise<void> {
  const orderId = session.metadata?.orderId?.trim();
  if (!orderId || session.metadata?.orderIds) return; // legacy multi-order sessions: out of scope
  ctx.summary.qrSessionsChecked += 1;
  const { id: piId, obj: pi } = piOf(session);
  const subjectKey = `qr_order:${orderId}`;
  const findOrder = () =>
    prisma.physicalQrOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        businessId: true,
        paymentStatus: true,
        totalAmount: true,
        currency: true,
        stripePaymentIntentId: true,
        stripeCheckoutSessionId: true,
      },
    });
  let order = await findOrder();
  const kinds: Array<{ kind: string; details?: Record<string, unknown> }> = [];
  const repairedKinds: string[] = [];

  if (session.payment_status === "paid" && piId) {
    paidSessionsByOrder.set(orderId, [...(paidSessionsByOrder.get(orderId) ?? []), session.id]);
    if (!order) {
      kinds.push({ kind: "paid_session_without_order", details: { amountTotal: session.amount_total ?? null } });
    } else {
      const unlinked = order.stripePaymentIntentId !== piId;
      if (unlinked && ctx.repair && (order.paymentStatus === "PENDING" || order.paymentStatus === "FAILED" || isPhysicalQrPaidFamilyStatus(order.paymentStatus))) {
        // Same verified path as the webhook: marks paid, holds for review, or refunds a duplicate.
        const { handlePhysicalQrCheckoutSessionCompleted } = await import("../physicalQr/physicalQrWebhook.service.js");
        await handlePhysicalQrCheckoutSessionCompleted(session);
        const before = order.paymentStatus;
        order = await findOrder();
        if (order && (order.stripePaymentIntentId === piId || order.paymentStatus !== before)) {
          repairedKinds.push("paid_session_pending_order");
          ctx.summary.repaired += 1;
        }
      }
      if (order && order.stripePaymentIntentId !== piId) {
        if (order.paymentStatus === "PENDING" || order.paymentStatus === "FAILED") {
          kinds.push({ kind: "paid_session_pending_order", details: { amountTotal: session.amount_total ?? null } });
        } else {
          const op = await prisma.stripeRefundOperation.findFirst({ where: { stripePaymentIntentId: piId }, select: { status: true } });
          const charge = chargeOf(pi);
          const refunded = charge ? charge.refunded || charge.amount_refunded >= charge.amount : false;
          if (!refunded && (!op || op.status === StripeRefundOperationStatus.failed_permanent)) {
            kinds.push({ kind: "duplicate_payment_unrefunded", details: { orderPaymentIntentId: order.stripePaymentIntentId, refundOperation: op?.status ?? null } });
          }
        }
      } else if (order) {
        if (order.paymentStatus === "PAID" && typeof session.amount_total === "number" && session.amount_total !== order.totalAmount) {
          kinds.push({ kind: "order_amount_mismatch", details: { orderTotal: order.totalAmount, stripeCents: session.amount_total } });
        }
        if (String(session.currency ?? "").toLowerCase() !== order.currency.toLowerCase()) {
          kinds.push({ kind: "order_currency_mismatch", details: { orderCurrency: order.currency, stripeCurrency: session.currency ?? null } });
        }
        const charge = chargeOf(pi);
        if (charge) {
          let local = await localQrAdjustmentTotals(order.id);
          if (local.refundedCents !== charge.amount_refunded && ctx.repair) {
            const { listStripeRefundsForPaymentIntent } = await import("../stripe.service.js");
            const { applyPhysicalQrRefundEvent } = await import("../physicalQr/physicalQrPayments.service.js");
            for (const r of await listStripeRefundsForPaymentIntent(piId)) {
              await applyPhysicalQrRefundEvent({
                stripeRefundId: r.id,
                stripePaymentIntentId: piId,
                stripeChargeId: typeof r.charge === "string" ? r.charge : r.charge?.id ?? null,
                amountCents: r.amount,
                currency: r.currency,
                status: r.status ?? "pending",
                reason: typeof r.reason === "string" ? r.reason : null,
                occurredAt: new Date(r.created * 1000),
              });
            }
            local = await localQrAdjustmentTotals(order.id);
            if (local.refundedCents === charge.amount_refunded) {
              repairedKinds.push("order_refund_mismatch");
              ctx.summary.repaired += 1;
            }
          }
          if (local.refundedCents !== charge.amount_refunded) {
            kinds.push({ kind: "order_refund_mismatch", details: { localRefundedCents: local.refundedCents, stripeRefundedCents: charge.amount_refunded } });
          }
          if (charge.disputed && local.disputes === 0) {
            kinds.push({ kind: "order_dispute_not_recorded" });
          }
        }
      }
    }
  } else if (order && order.stripeCheckoutSessionId === session.id && !order.stripePaymentIntentId && isPhysicalQrPaidFamilyStatus(order.paymentStatus)) {
    // The order is marked paid, but its only session never collected money.
    kinds.push({ kind: "order_paid_without_payment", details: { sessionStatus: session.status, paymentStatus: session.payment_status } });
  }

  await recordKinds({
    workflow: "qr_order",
    subjectKey,
    kinds,
    allKinds: QR_RECON_KINDS,
    refs: {
      businessId: order?.businessId ?? session.metadata?.businessId ?? null,
      stripePaymentIntentId: piId,
      stripeCheckoutSessionId: session.id,
      physicalQrOrderId: order?.id ?? null,
    },
    repairedKinds,
    ctx,
  });
}

/** Local tips the listing did not cover: confirm each against its PaymentIntent. */
async function reverseCheckTips(windowStart: Date, seenPaymentIntents: Set<string>, ctx: Ctx): Promise<void> {
  const tips = await prisma.transaction.findMany({
    where: {
      status: "success",
      stripePaymentIntentId: { startsWith: "pi_" },
      createdAt: { gte: windowStart, lte: new Date(Date.now() - SETTLE_MS) },
    },
    select: { id: true, amount: true, businessId: true, stripePaymentIntentId: true },
    orderBy: { createdAt: "desc" },
    take: 5000,
  });
  let lookups = 0;
  for (const tip of tips) {
    const piId = tip.stripePaymentIntentId!;
    if (seenPaymentIntents.has(piId)) continue;
    if (lookups >= MAX_REVERSE_LOOKUPS) break;
    lookups += 1;
    const subjectKey = `tip:${piId}`;
    let ok = false;
    let details: Record<string, unknown> = {};
    try {
      const pi = await retrievePaymentIntentAuthoritative(piId);
      ok = pi.status === "succeeded" && (pi.amount_received ?? 0) === Math.round(Number(tip.amount) * 100);
      details = { paymentIntentStatus: pi.status, amountReceived: pi.amount_received ?? null };
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code !== "resource_missing") {
        ctx.summary.errors += 1;
        continue;
      }
      details = { paymentIntent: "missing" };
    }
    await recordKinds({
      workflow: "tip",
      subjectKey,
      kinds: ok ? [] : [{ kind: "local_tip_without_stripe_payment", details }],
      allKinds: ["local_tip_without_stripe_payment"],
      refs: { businessId: tip.businessId, stripePaymentIntentId: piId, transactionId: tip.id },
      ctx,
    });
  }
}

export async function runPaymentReconciliation(opts?: {
  windowHours?: number;
  repair?: boolean;
  maxSessions?: number;
}): Promise<PaymentReconciliationSummary> {
  const windowHours = opts?.windowHours ?? windowHoursFromEnv();
  const repair = opts?.repair ?? process.env.PAYMENT_RECONCILIATION_REPAIR === "true";
  const summary: PaymentReconciliationSummary = {
    windowHours,
    repair,
    sessionsScanned: 0,
    truncated: false,
    tipsChecked: 0,
    qrSessionsChecked: 0,
    discrepanciesOpen: 0,
    repaired: 0,
    errors: 0,
  };
  if (!process.env.STRIPE_SECRET_KEY?.trim() && !sessionsListFnForTests) {
    return { ...summary, skipped: "stripe_not_configured" };
  }
  const lease = await tryAcquirePaymentOperationLease(RUN_LEASE_KEY, RUN_LEASE_TTL_MS);
  if (!lease) return { ...summary, skipped: "already_running" };
  const ctx: Ctx = { repair, summary };
  try {
    const now = Date.now();
    const windowStart = new Date(now - windowHours * 60 * 60_000);
    const { sessions, truncated } = await listCheckoutSessions(
      Math.floor(windowStart.getTime() / 1000),
      opts?.maxSessions ?? DEFAULT_MAX_SESSIONS,
    );
    summary.sessionsScanned = sessions.length;
    summary.truncated = truncated;
    const seenPaymentIntents = new Set<string>();
    const paidSessionsByOrder = new Map<string, string[]>();
    for (const session of sessions) {
      // Very recent sessions may still be in flight through their webhook.
      if ((session.created ?? 0) * 1000 > now - SETTLE_MS) {
        const id = piOf(session).id;
        if (id) seenPaymentIntents.add(id);
        continue;
      }
      try {
        const source = session.metadata?.source;
        if (source === "checkout_session") {
          const id = piOf(session).id;
          if (id) seenPaymentIntents.add(id);
          await reconcileTipSession(session, ctx);
        } else if (source === PHYSICAL_QR_CHECKOUT_METADATA_SOURCE) {
          await reconcileQrSession(session, ctx, paidSessionsByOrder);
        }
      } catch (err) {
        summary.errors += 1;
        console.error("[payment.reconciliation] session check failed", {
          sessionId: session.id,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    for (const [orderId, paid] of paidSessionsByOrder) {
      if (paid.length > 1) {
        await recordPaymentDiscrepancy({
          workflow: "qr_order",
          kind: "multiple_paid_sessions",
          subjectKey: `qr_order:${orderId}`,
          physicalQrOrderId: orderId,
          details: { paidSessionIds: paid },
        });
        summary.discrepanciesOpen += 1;
      }
    }
    // Only a complete listing proves a payment is absent from Stripe.
    if (!truncated) {
      await reverseCheckTips(windowStart, seenPaymentIntents, ctx);
    }
    console.info("[payment.reconciliation] done", summary);
    return summary;
  } finally {
    await releasePaymentOperationLease(lease).catch(() => {});
  }
}
