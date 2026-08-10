import Stripe from "stripe";
import { emitNewTip } from "../socket/emitTip.js";
import { prisma } from "../prisma.js";
import { businessUtcRangeForTimeframe, sanitizeIanaTimezone } from "../utils/businessTime.js";
import { assertTipAmountInRangeEur } from "../constants/tipAmountLimits.js";
import { captureServerException } from "../instrument/sentry.js";
import { logServerError } from "../utils/httpErrors.js";
import {
  assertEmployeeEligibleForTipPayment,
  logTipPaymentEligibilityBlocked,
} from "./tipPaymentEligibility.service.js";
import { recordCheckoutFunnelEvent } from "./checkoutFunnelMetrics.service.js";
import { QR_FUNNEL_EVENT_TYPES, recordQrFunnelEvent } from "./qr/qrFunnelEvent.service.js";
import { allocateTipReceiptNumber } from "./tipReceipt.service.js";
import {
  schedulePaymentFailedAfterPendingUpdate,
  schedulePaymentRefundedProjection,
} from "./activity/paymentActivity.projection.js";

let stripeSingleton: Stripe | null = null;

/** True when server has a secret key — safe to call at runtime; does not construct Stripe. */
export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim());
}

/** Lazy init — never `new Stripe("")` at module load (crashes on Render if env missing). */
export function getStripeClient(): Stripe {
  return getStripe();
}

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) {
    throw new Error("Stripe payment processing is not configured (set STRIPE_SECRET_KEY on the server)");
  }
  if (!stripeSingleton) {
    stripeSingleton = new Stripe(key);
  }
  return stripeSingleton;
}

/**
 * Verify Stripe webhook signature (raw body required — do not JSON-parse before this).
 */
export function verifyWebhookSignature(
  rawBody: Buffer,
  signature: string | string[] | undefined,
): Stripe.Event {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error("STRIPE_WEBHOOK_SECRET not configured");
  }
  const sig = Array.isArray(signature) ? signature[0] : signature;
  if (!sig || typeof sig !== "string") {
    throw new Error("Missing stripe-signature header");
  }
  return getStripe().webhooks.constructEvent(rawBody, sig, webhookSecret);
}

function frontendBaseUrl(): string {
  return (process.env.FRONTEND_URL ?? "http://localhost:5173").replace(/\/$/, "");
}

const AMOUNT_EPSILON_EUR = 0.001;

/** Stripe amounts are integer cents — convert to EUR for ledger storage. */
export function stripeCentsToEur(cents: number | null | undefined): number | null {
  if (cents == null || !Number.isFinite(cents) || cents <= 0) return null;
  return cents / 100;
}

function amountsMatchEur(a: number, b: number): boolean {
  return Math.abs(a - b) <= AMOUNT_EPSILON_EUR;
}

function logStripeAmountMismatch(context: string, details: Record<string, unknown>): void {
  console.warn(`[stripe.amount_mismatch] ${context}`, details);
}

/** Defense-in-depth: reject non-EUR Stripe objects before ledger writes. */
export function assertStripeCurrencyEur(
  currency: string | null | undefined,
  context: Record<string, unknown>,
): void {
  const normalized = String(currency ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "eur") return;
  console.error("[stripe.currency_violation]", { currency, ...context });
  captureServerException(new Error("Unexpected Stripe currency"), { currency, ...context });
  throw new Error("Unexpected currency");
}

function logStripeCurrencyViolationRepeat(context: Record<string, unknown>): void {
  console.warn("[stripe.currency_violation.repeat]", context);
}

/** Set STRIPE_WEBHOOK_DEBUG=true to log checkout webhook skip/create details (no secrets). */
function stripeWebhookDebug(context: string, details: Record<string, unknown>): void {
  if (process.env.STRIPE_WEBHOOK_DEBUG !== "true") return;
  console.info(`[stripe.webhook.debug] ${context}`, details);
}

/**
 * Canonical paid EUR from a Checkout Session — never trust client metadata amounts.
 */
function confirmedEurFromCheckoutSession(session: Stripe.Checkout.Session): number | null {
  const fromTotal = stripeCentsToEur(session.amount_total);
  if (fromTotal != null) return fromTotal;

  const pi = session.payment_intent;
  if (pi && typeof pi === "object" && "amount_received" in pi) {
    const received = (pi as Stripe.PaymentIntent).amount_received;
    const fromPi = stripeCentsToEur(received ?? (pi as Stripe.PaymentIntent).amount);
    if (fromPi != null) return fromPi;
  }
  return null;
}

async function confirmedEurFromPaymentIntentId(paymentIntentId: string): Promise<number | null> {
  const stripe = getStripe();
  const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
  return stripeCentsToEur(pi.amount_received ?? pi.amount);
}

export type TipCheckoutContext = {
  sessionId: string;
  paymentIntentId: string | null;
  checkoutStatus: Stripe.Checkout.Session.Status | null;
  paymentStatus: Stripe.Checkout.Session.PaymentStatus | null;
  employeeId: string | null;
  businessId: string | null;
  locationId: string | null;
  tableId: string | null;
  customerName: string | null;
};

/**
 * Public feedback pages need to resolve a Stripe Checkout session id into
 * business/employee/venue context and (eventually) a Transaction row.
 */
export async function getTipCheckoutContext(
  sessionId: string,
): Promise<TipCheckoutContext> {
  const stripe = getStripe();
  const s = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["payment_intent"],
  });
  const md = s.metadata ?? {};
  const pi = s.payment_intent;
  const paymentIntentId =
    typeof pi === "string" ? pi : pi?.id ?? null;

  return {
    sessionId: s.id,
    paymentIntentId,
    checkoutStatus: s.status ?? null,
    paymentStatus: s.payment_status ?? null,
    employeeId: typeof md.employeeId === "string" ? md.employeeId : null,
    businessId: typeof md.businessId === "string" ? md.businessId : null,
    locationId: typeof md.locationId === "string" ? md.locationId : null,
    tableId: typeof md.tableId === "string" ? md.tableId : null,
    customerName: typeof md.customerName === "string" ? md.customerName : null,
  };
}

export interface CreateTipCheckoutSessionInput {
  /** Total EUR charged in Stripe (bill + tip when both apply). */
  amount: number;
  employeeId: string;
  businessId: string;
  /** Tip portion stored on `tips.amount` and in metadata; defaults to `amount`. */
  tipAmount?: number;
  locationId?: string | null;
  tableId?: string | null;
  customerName?: string | null;
  feedback?: string | null;
  /** Guest scan session from QR flow — links funnel to qr_scan_events. */
  qrScanSessionId?: string | null;
}

export interface CreateTipCheckoutSessionResult {
  sessionId: string;
  url: string | null;
}

async function resolveLocationTable(
  businessId: string,
  locationId?: string | null,
  tableId?: string | null,
): Promise<{ locationId: string | null; tableId: string | null }> {
  const trimmedLoc = typeof locationId === "string" && locationId.trim() ? locationId.trim() : null;
  const trimmedTbl = typeof tableId === "string" && tableId.trim() ? tableId.trim() : null;
  let resolvedLocationId: string | null = trimmedLoc;
  let resolvedTableId: string | null = trimmedTbl;

  if (resolvedTableId) {
    const table = await prisma.table.findUnique({
      where: { id: resolvedTableId },
      select: {
        id: true,
        locationId: true,
        location: { select: { businessId: true } },
      },
    });
    if (!table || table.location.businessId !== businessId) {
      throw new Error("Table not found");
    }
    resolvedLocationId = table.locationId;
    resolvedTableId = table.id;
  } else if (resolvedLocationId) {
    const loc = await prisma.location.findFirst({
      where: { id: resolvedLocationId, businessId },
      select: { id: true },
    });
    if (!loc) {
      throw new Error("Location not found");
    }
  }
  return { locationId: resolvedLocationId, tableId: resolvedTableId };
}

async function loadTipEmitSnapshot(
  employeeId: string | null,
  businessId: string,
): Promise<{
  employeeName: string;
  employeeUserId: string | undefined;
  monthlyGoal: number | null;
  businessTimezone: string;
  businessManagerUserId: string;
} | null> {
  if (!employeeId) {
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { timezone: true, userId: true },
    });
    if (!business) return null;
    return {
      employeeName: "Former staff",
      employeeUserId: undefined,
      monthlyGoal: null,
      businessTimezone: business.timezone,
      businessManagerUserId: business.userId,
    };
  }
  const row = await prisma.employee.findFirst({
    where: { id: employeeId, businessId },
    select: {
      name: true,
      monthlyGoal: true,
      userId: true,
      business: { select: { timezone: true, userId: true } },
    },
  });
  if (!row) return null;
  return {
    employeeName: row.name,
    employeeUserId: row.userId ?? undefined,
    monthlyGoal: row.monthlyGoal != null ? Number(row.monthlyGoal) : null,
    businessTimezone: row.business.timezone,
    businessManagerUserId: row.business.userId,
  };
}

async function emitTipSocketWithSnapshot(
  tip: {
    id: string;
    amount: unknown;
    status: string;
    createdAt: Date;
    employeeId: string | null;
    businessId: string;
    customerName?: string | null;
  },
  snapshot: NonNullable<Awaited<ReturnType<typeof loadTipEmitSnapshot>>>,
): Promise<void> {
  const tz = sanitizeIanaTimezone(snapshot.businessTimezone);
  const monthRange = businessUtcRangeForTimeframe("month", tz);
  const currentMonthTotalAgg = tip.employeeId
    ? await prisma.transaction.aggregate({
        where: {
          employeeId: tip.employeeId,
          status: "success",
          ...(monthRange != null
            ? { createdAt: { gte: monthRange.startUtc, lte: monthRange.endUtc } }
            : { createdAt: { gte: new Date(0) } }),
        },
        _sum: { amount: true },
      })
    : { _sum: { amount: null as number | null } };
  const currentMonthTotal = Number(currentMonthTotalAgg._sum.amount ?? 0);

  emitNewTip({
    tip: {
      id: tip.id,
      amount: Number(tip.amount),
      status: tip.status,
      createdAt: tip.createdAt.toISOString(),
    },
    employeeId: tip.employeeId,
    employeeName: snapshot.employeeName,
    customerName: tip.customerName ?? null,
    employeeUserId: snapshot.employeeUserId,
    businessId: tip.businessId,
    businessManagerUserId: snapshot.businessManagerUserId,
    currentMonthTotal,
    monthlyGoal: snapshot.monthlyGoal,
  });
}

/**
 * Stripe Checkout — Apple Pay / Google Pay / card on Stripe-hosted page (EUR).
 * Wallets are offered by Stripe where supported when using `card`.
 */
export async function createTipCheckoutSession(
  input: CreateTipCheckoutSessionInput,
): Promise<CreateTipCheckoutSessionResult> {
  const stripe = getStripe();

  const { employeeId, businessId } = input;
  const total = Number(input.amount);
  const tipRaw = input.tipAmount != null ? Number(input.tipAmount) : total;

  if (!employeeId || !businessId || Number.isNaN(total) || total <= 0) {
    throw new Error("Invalid amount or business context");
  }
  if (Number.isNaN(tipRaw) || tipRaw <= 0) {
    throw new Error("Invalid tip amount");
  }
  if (!amountsMatchEur(total, tipRaw)) {
    logStripeAmountMismatch("createTipCheckoutSession", {
      employeeId,
      businessId,
      amount: total,
      tipAmount: tipRaw,
    });
    throw new Error("Tip amount must match the checkout total");
  }
  const tipForRecord = total;

  await assertEmployeeEligibleForTipPayment(employeeId, businessId);

  const { locationId: locId, tableId: tblId } = await resolveLocationTable(
    businessId,
    input.locationId,
    input.tableId,
  );

  assertTipAmountInRangeEur(total);

  const totalCents = Math.round(total * 100);

  const base = frontendBaseUrl();
  const metadata: Record<string, string> = {
    employeeId,
    businessId,
    source: "checkout_session",
  };
  if (locId) metadata.locationId = locId;
  if (tblId) metadata.tableId = tblId;
  const scanSession = input.qrScanSessionId?.trim();
  if (scanSession) metadata.qrScanSessionId = scanSession.slice(0, 64);
  const name = input.customerName?.trim();
  if (name) metadata.customerName = name;
  const fb = input.feedback?.trim();
  if (fb) metadata.feedback = fb.slice(0, 2000);

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "eur",
            unit_amount: totalCents,
            product_data: {
              name: "CareTip payment",
              description: `Tip €${tipForRecord.toFixed(2)}`,
            },
          },
          quantity: 1,
        },
      ],
      // Post-checkout: go directly to optional feedback page (no extra success screen).
      success_url: `${base}/rating?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/payment?canceled=1`,
      metadata,
    });
  } catch (e) {
    if (e instanceof Stripe.errors.StripeError) {
      console.error("[Stripe checkout.sessions.create]", e.code, e.message);
      throw new Error("Payment provider could not start checkout");
    }
    throw e;
  }

  recordCheckoutFunnelEvent("started", {
    sessionId: session.id,
    employeeId,
    businessId,
  });

  return {
    sessionId: session.id,
    url: session.url,
  };
}

/**
 * Refund a captured tip when post-payment eligibility checks fail (employee deactivated, venue unverified, etc.).
 * Best-effort — logs and alerts ops if Stripe refund fails.
 * Returns Stripe refund id on success; null on failure (callers must not project payment.refunded).
 */
async function refundTipPaymentForEligibilityFailure(
  paymentIntentId: string,
  context: Record<string, unknown>,
  eligibilityErr: unknown,
): Promise<string | null> {
  const source = typeof context.source === "string" ? context.source : "stripe.eligibility_refund";
  logTipPaymentEligibilityBlocked(source, { paymentIntentId, ...context }, eligibilityErr);

  try {
    const stripe = getStripe();
    const refund = await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        metadata: {
          caretip_refund_reason: "eligibility_failure",
          caretip_context: source,
        },
      },
      {
        idempotencyKey: `eligibility_refund:${paymentIntentId}`,
      },
    );
    console.warn("[stripe.refund.eligibility_failure] refunded", {
      paymentIntentId,
      refundId: refund.id,
      status: refund.status,
      ...context,
    });
    captureServerException(new Error("Tip payment refunded: post-payment eligibility failure"), {
      paymentIntentId,
      refundId: refund.id,
      ...context,
    });
    return refund.id;
  } catch (refundErr) {
    logServerError("stripe.refund.eligibility_failure", refundErr, {
      paymentIntentId,
      ...context,
    });
    captureServerException(refundErr, {
      phase: "eligibility_refund_failed",
      paymentIntentId,
      ...context,
    });
    return null;
  }
}

export async function handlePaymentSuccess(paymentIntentId: string): Promise<void> {
  let confirmedEur: number | null = null;
  let customerNameFromPi: string | null = null;
  try {
    const stripe = getStripe();
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    try {
      assertStripeCurrencyEur(pi.currency, {
        paymentIntentId,
        phase: "payment_intent.succeeded",
      });
    } catch (err) {
      logStripeCurrencyViolationRepeat({
        paymentIntentId,
        currency: pi.currency,
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    const mdName =
      typeof pi.metadata?.customerName === "string" ? pi.metadata.customerName.trim() : "";
    customerNameFromPi = mdName || null;
    confirmedEur = stripeCentsToEur(pi.amount_received ?? pi.amount);
  } catch (err) {
    console.error("[stripe.handlePaymentSuccess] retrieve PI", paymentIntentId, err);
  }

  const pending = await prisma.transaction.findFirst({
    where: { stripePaymentIntentId: paymentIntentId, status: "pending" },
  });
  if (!pending) {
    return;
  }

  try {
    if (!pending.employeeId) {
      throw new Error("Tip has no linked employee");
    }
    await assertEmployeeEligibleForTipPayment(pending.employeeId, pending.businessId);
  } catch (err) {
    await prisma.transaction.updateMany({
      where: { id: pending.id, status: "pending" },
      data: { status: "failed" },
    });
    const refundId = await refundTipPaymentForEligibilityFailure(paymentIntentId, {
      source: "handlePaymentSuccess",
      employeeId: pending.employeeId ?? undefined,
      businessId: pending.businessId,
      transactionId: pending.id,
    }, err);
    if (refundId) {
      const emp = pending.employeeId
        ? await prisma.employee.findUnique({
            where: { id: pending.employeeId },
            select: { name: true },
          })
        : null;
      schedulePaymentRefundedProjection({
        paymentIntentId,
        refundId,
        transactionId: pending.id,
        businessId: pending.businessId,
        employeeId: pending.employeeId,
        amountEur: Number(pending.amount),
        employeeName: emp?.name ?? null,
      });
      void import("./finance/tipRefunds.service.js").then(({ upsertStripeRefundEvent }) =>
        upsertStripeRefundEvent({
          stripeRefundId: refundId,
          stripePaymentIntentId: paymentIntentId,
          amountCents: Math.round(Number(pending.amount) * 100),
          currency: "eur",
          status: "succeeded",
          reason: "eligibility_failure",
          occurredAt: new Date(),
          businessId: pending.businessId,
          tipId: pending.id,
        }),
      );
    }
    return;
  }

  if (confirmedEur != null && !amountsMatchEur(Number(pending.amount), confirmedEur)) {
    logStripeAmountMismatch("handlePaymentSuccess", {
      paymentIntentId,
      ledgerAmount: Number(pending.amount),
      stripeAmount: confirmedEur,
    });
  }

  const data: { status: "success"; amount?: number } = { status: "success" };
  if (confirmedEur != null) {
    data.amount = confirmedEur;
  }

  await prisma.$transaction(async (tx) => {
    const receiptNumber = await allocateTipReceiptNumber(tx, pending.createdAt);
    await tx.transaction.update({
      where: { id: pending.id },
      data: { ...data, receiptNumber },
    });
  });

  const emitSnapshot = await loadTipEmitSnapshot(pending.employeeId, pending.businessId);
  if (!emitSnapshot) {
    return;
  }

  const tip = await prisma.transaction.findFirst({
    where: { stripePaymentIntentId: paymentIntentId },
    select: {
      id: true,
      amount: true,
      status: true,
      createdAt: true,
      employeeId: true,
      businessId: true,
    },
  });

  if (!tip) {
    return;
  }

  await emitTipSocketWithSnapshot({ ...tip, customerName: customerNameFromPi }, emitSnapshot);
}

export async function handlePaymentFailed(paymentIntentId: string): Promise<void> {
  const result = await prisma.transaction.updateMany({
    where: { stripePaymentIntentId: paymentIntentId, status: "pending" },
    data: { status: "failed" },
  });
  schedulePaymentFailedAfterPendingUpdate(paymentIntentId, result.count, "payment_intent_failed");
}

/**
 * Persist tip from Stripe Checkout (idempotent on payment_intent id).
 * Alias for integrations that prefer an explicit name.
 */
export async function handleSuccessfulTipPayment(session: Stripe.Checkout.Session): Promise<void> {
  const md = session.metadata ?? {};
  const employeeIdEarly = md.employeeId ?? null;
  const businessIdEarly = md.businessId ?? null;
  const piEarly = session.payment_intent;
  const paymentIntentIdEarly =
    typeof piEarly === "string" ? piEarly : piEarly?.id ?? null;

  console.log("WEBHOOK START");
  console.log({
    sessionId: session.id,
    paymentIntentId: paymentIntentIdEarly,
    employeeId: employeeIdEarly,
    businessId: businessIdEarly,
    amount: session.amount_total != null ? session.amount_total / 100 : null,
    paymentStatus: session.payment_status ?? null,
    metadata: session.metadata ?? {},
  });

  if (session.payment_status && session.payment_status !== "paid") {
    console.log("SKIP REASON: payment_status not paid");
    return;
  }

  try {
    assertStripeCurrencyEur(session.currency, {
      sessionId: session.id,
      phase: "checkout.session.completed",
    });
  } catch (err) {
    logStripeCurrencyViolationRepeat({
      sessionId: session.id,
      message: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  const pi = session.payment_intent;
  const piId = typeof pi === "string" ? pi : pi?.id ?? null;
  if (!piId) {
    console.log("SKIP REASON: missing paymentIntentId");
    return;
  }

  const dup = await prisma.transaction.findFirst({
    where: { stripePaymentIntentId: piId },
  });
  if (dup) {
    console.log("SKIP REASON: duplicate payment intent", { existingTipId: dup.id, paymentIntentId: piId });
    return;
  }

  let confirmedEur = confirmedEurFromCheckoutSession(session);
  if (confirmedEur == null) {
    try {
      confirmedEur = await confirmedEurFromPaymentIntentId(piId);
    } catch (err) {
      console.error("[stripe.handleSuccessfulTipPayment] retrieve PI", piId, err);
    }
  }
  if (confirmedEur == null || confirmedEur <= 0) {
    console.error("[stripe.handleSuccessfulTipPayment] missing Stripe amount", {
      sessionId: session.id,
      paymentIntentId: piId,
      amountTotal: session.amount_total ?? null,
      confirmedEur,
    });
    console.log("SKIP REASON: amount missing");
    return;
  }

  const employeeId = md.employeeId;
  const businessId = md.businessId;

  const metadataTip = md.tipAmount ?? md.amount ?? md.totalAmount;
  if (metadataTip != null && metadataTip !== "") {
    const parsedMeta = parseFloat(metadataTip);
    if (!Number.isNaN(parsedMeta) && !amountsMatchEur(parsedMeta, confirmedEur)) {
      logStripeAmountMismatch("handleSuccessfulTipPayment", {
        sessionId: session.id,
        paymentIntentId: piId,
        metadataAmount: parsedMeta,
        stripeAmount: confirmedEur,
      });
    }
  }

  if (!employeeId) {
    console.log("SKIP REASON: missing employeeId");
    return;
  }
  if (!businessId) {
    console.log("SKIP REASON: missing businessId");
    return;
  }

  try {
    await assertEmployeeEligibleForTipPayment(employeeId, businessId);
  } catch (err) {
    let transactionId: string | null = null;
    let amountEur = confirmedEur;
    try {
      const failedTip = await prisma.transaction.create({
        data: {
          amount: confirmedEur,
          status: "failed",
          stripePaymentIntentId: piId,
          employeeId,
          businessId,
        },
      });
      transactionId = failedTip.id;
      amountEur = Number(failedTip.amount);
    } catch (ledgerErr) {
      const code = (ledgerErr as { code?: string })?.code;
      if (code !== "P2002") {
        console.error("[stripe.handleSuccessfulTipPayment] failed ledger insert", ledgerErr);
      } else {
        const existing = await prisma.transaction.findUnique({
          where: { stripePaymentIntentId: piId },
          select: { id: true, amount: true, status: true },
        });
        if (existing) {
          transactionId = existing.id;
          amountEur = Number(existing.amount);
          if (existing.status !== "failed") {
            await prisma.transaction.update({
              where: { id: existing.id },
              data: { status: "failed" },
            });
          }
        }
      }
    }

    const refundId = await refundTipPaymentForEligibilityFailure(piId, {
      source: "handleSuccessfulTipPayment",
      sessionId: session.id,
      employeeId,
      businessId,
      amountEur: confirmedEur,
      transactionId,
    }, err);

    if (refundId && transactionId) {
      const emp = await prisma.employee.findUnique({
        where: { id: employeeId },
        select: { name: true },
      });
      schedulePaymentRefundedProjection({
        paymentIntentId: piId,
        refundId,
        transactionId,
        businessId,
        employeeId,
        amountEur,
        employeeName: emp?.name ?? null,
      });
      void import("./finance/tipRefunds.service.js").then(({ upsertStripeRefundEvent }) =>
        upsertStripeRefundEvent({
          stripeRefundId: refundId,
          stripePaymentIntentId: piId,
          amountCents: Math.round(Number(amountEur) * 100),
          currency: "eur",
          status: "succeeded",
          reason: "eligibility_failure",
          occurredAt: new Date(),
          businessId,
          tipId: transactionId,
        }),
      );
    }

    console.log("SKIP REASON: employee or venue not eligible for tips (refund attempted)");
    return;
  }

  const emitSnapshot = await loadTipEmitSnapshot(employeeId, businessId);

  let locId: string | null = null;
  let tblId: string | null = null;
  try {
    const r = await resolveLocationTable(businessId, md.locationId ?? null, md.tableId ?? null);
    locId = r.locationId;
    tblId = r.tableId;
  } catch {
    // invalid locationId/tableId — non-fatal; insert proceeds without venue ids
  }

  const customerNameRaw =
    typeof md.customerName === "string" ? md.customerName.trim() : "";

  const payload = {
    amount: confirmedEur,
    status: "success" as const,
    stripePaymentIntentId: piId,
    employeeId,
    businessId,
    locationId: locId,
    tableId: tblId,
  };

  console.log("ATTEMPTING TIP INSERT", payload);

  try {
    const tip = await prisma.$transaction(async (tx) => {
      const receiptNumber = await allocateTipReceiptNumber(tx);
      return tx.transaction.create({
        data: { ...payload, receiptNumber },
      });
    });

    console.log("TIP CREATED", tip.id);
    console.info("[tip-reconcile] webhook_tip_created", {
      checkoutSessionId: session.id,
      paymentIntentId: piId,
      tipId: tip.id,
      tipCreatedAt: tip.createdAt?.toISOString?.() ?? new Date().toISOString(),
      businessId,
      employeeId,
      customerName: typeof md.customerName === "string" ? md.customerName : null,
      amountEur: confirmedEur,
    });

    recordCheckoutFunnelEvent("completed", {
      sessionId: session.id,
      paymentIntentId: piId,
      employeeId,
      businessId,
      amountEur: confirmedEur,
      paymentStatus: session.payment_status ?? null,
    });

    const qrScanSessionId = typeof md.qrScanSessionId === "string" ? md.qrScanSessionId.trim() : "";
    if (qrScanSessionId) {
      recordQrFunnelEvent({
        businessId,
        sessionId: qrScanSessionId,
        eventType: QR_FUNNEL_EVENT_TYPES.PAYMENT_COMPLETED,
        employeeId,
        locationId: locId,
        tableId: tblId,
        transactionId: tip.id,
      });
      void import("./qr/qrGuestVisit.service.js").then(({ completeGuestVisit }) =>
        completeGuestVisit(businessId, qrScanSessionId),
      );
    }

    if (emitSnapshot) {
      await emitTipSocketWithSnapshot(
        { ...tip, customerName: customerNameRaw || null },
        emitSnapshot,
      );
    }
  } catch (err) {
    const code = (err as { code?: string })?.code;
    console.error("TIP INSERT FAILED", err);
    if (code === "P2002") {
      console.log("SKIP REASON: duplicate payment intent (unique constraint on insert)");
      return;
    }
    throw err;
  }
}

/** @deprecated Use handleSuccessfulTipPayment */
export const handleCheckoutSessionCompleted = handleSuccessfulTipPayment;
