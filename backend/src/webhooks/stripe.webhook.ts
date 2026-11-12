import { Router, type Request, type Response } from "express";
import Stripe from "stripe";
import {
  verifyWebhookSignature,
  handleSuccessfulTipPayment,
  handlePaymentSuccess,
  handlePaymentFailed,
} from "../services/stripe.service.js";
import { BillingWebhookConcurrentDeliveryError } from "../services/billingWebhookIdempotency.service.js";
import {
  handleStripeBillingWebhookEvent,
  isStripeBillingEventType,
  isSubscriptionCheckoutSession,
} from "../services/stripeBillingWebhook.service.js";
import { handleConnectAccountUpdated } from "../services/stripeConnect.service.js";
import { handleEmployeeConnectAccountUpdated } from "../services/employeeStripeConnect.service.js";
import { attributeStripeConnectAccount } from "../services/connectAccountOwnership.service.js";
import {
  handleConnectPayoutEvent,
  isConnectPayoutEventType,
} from "../services/stripeConnectPayout.service.js";
import { StripeWebhookConcurrentDeliveryError } from "../services/stripeWebhookIdempotency.service.js";
import {
  acquireStripeWebhookProcessingClaim,
  finalizeStripeWebhookClaimFailed,
  finalizeStripeWebhookClaimProcessed,
} from "../services/stripeWebhookProcessingClaim.service.js";
import { recordCheckoutSessionExpired } from "../services/checkoutFunnelMetrics.service.js";
import { logTrialSync } from "../lib/subscription/trialSyncDebugLog.js";
import { logServerError } from "../utils/httpErrors.js";
import {
  upsertStripeRefundEvent,
  upsertStripeDisputeEvent,
} from "../services/finance/tipRefunds.service.js";
import { isPhysicalQrCheckoutSession } from "../services/physicalQr/physicalQrCheckout.service.js";
import {
  handlePhysicalQrAsyncPaymentFailed,
  handlePhysicalQrCheckoutExpired,
  handlePhysicalQrCheckoutSessionCompleted,
  handlePhysicalQrPaymentFailed,
} from "../services/physicalQr/physicalQrWebhook.service.js";

/**
 * POST /api/webhooks/stripe (mounted at /api/webhooks + /stripe)
 * Raw body required — registered in index.ts with express.raw({ type: "application/json" }).
 */
const router = Router();

/** A test-mode event must never touch a live ledger, or a live event a test one. */
export function isStripeEventModeMismatch(event: Pick<Stripe.Event, "livemode">, secretKey: string | undefined): boolean {
  const key = secretKey?.trim() ?? "";
  const keyLive = key.startsWith("sk_live_") || key.startsWith("rk_live_");
  const keyTest = key.startsWith("sk_test_") || key.startsWith("rk_test_");
  if (typeof event.livemode !== "boolean" || (!keyLive && !keyTest)) return false;
  return event.livemode !== keyLive;
}

const TIP_EVENT_TYPES = new Set([
  "checkout.session.expired",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "refund.created",
  "refund.failed",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
  "charge.refunded",
  "refund.updated",
  "charge.dispute.created",
  "charge.dispute.closed",
  "charge.dispute.updated",
]);

const CONNECT_EVENT_TYPES = new Set(["account.updated"]);

type StripeWebhookEndpoint = {
  kind: "platform" | "connect";
  secretEnv: "STRIPE_WEBHOOK_SECRET" | "STRIPE_CONNECT_WEBHOOK_SECRET";
};

/** Connected-account event types CareTip applies when they arrive on the Connect endpoint. */
const CONNECT_ENDPOINT_EVENT_TYPES = new Set([
  "account.updated",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
]);

function usesStripeWebhookEventStore(event: Stripe.Event): boolean {
  return (
    TIP_EVENT_TYPES.has(event.type) ||
    event.type === "checkout.session.completed" ||
    CONNECT_EVENT_TYPES.has(event.type) ||
    isConnectPayoutEventType(event.type)
  );
}

async function runWithStripeWebhookClaim(
  event: Stripe.Event,
  handler: () => Promise<void>,
): Promise<"duplicate" | "ok" | "retry"> {
  let claim;
  try {
    claim = await acquireStripeWebhookProcessingClaim(event.id, event.type);
  } catch (err) {
    if (err instanceof StripeWebhookConcurrentDeliveryError) {
      return "retry";
    }
    throw err;
  }
  if (claim.action === "duplicate") {
    return "duplicate";
  }
  try {
    await handler();
    const finalized = await finalizeStripeWebhookClaimProcessed({
      stripeEventId: event.id,
      claimToken: claim.claimToken,
      eventType: event.type,
    });
    if (!finalized) {
      logServerError("stripe.webhook.claimFinalizeLost", new Error("ownership_lost"), {
        eventId: event.id,
        eventType: event.type,
      });
      return "retry";
    }
    return "ok";
  } catch (err) {
    await finalizeStripeWebhookClaimFailed({
      stripeEventId: event.id,
      claimToken: claim.claimToken,
      eventType: event.type,
      error: err,
    });
    throw err;
  }
}

async function dispatchNonBillingStripeEvent(event: Stripe.Event): Promise<void> {
  if (event.type === "account.updated") {
    const account = event.data.object as Stripe.Account;
    const accountId = account.id?.trim() ?? "";
    const attribution = accountId
      ? await attributeStripeConnectAccount(accountId)
      : { kind: "unknown" as const };

    if (attribution.kind === "collision") {
      console.error("[stripe.webhook] account.updated collision — no status applied", {
        eventId: event.id,
        accountSuffix: accountId.slice(-8),
      });
    } else if (attribution.kind === "employee") {
      await handleEmployeeConnectAccountUpdated(account, { eventCreatedUnix: event.created });
    } else if (attribution.kind === "business") {
      await handleConnectAccountUpdated(account, { eventCreatedUnix: event.created });
    } else {
      await handleConnectAccountUpdated(account, { eventCreatedUnix: event.created });
      await handleEmployeeConnectAccountUpdated(account, { eventCreatedUnix: event.created });
    }
    return;
  }

  if (isConnectPayoutEventType(event.type)) {
    await handleConnectPayoutEvent(event);
    return;
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (isPhysicalQrCheckoutSession(session)) {
      return;
    }
    console.log("stripe.webhook: checkout.session.completed → handleSuccessfulTipPayment", {
      eventId: event.id,
      sessionId: session.id,
      mode: session.mode,
    });
    await handleSuccessfulTipPayment(session);
    return;
  }

  if (event.type === "checkout.session.async_payment_succeeded") {
    // Delayed payment methods: the session was completed earlier with payment_status "unpaid".
    const session = event.data.object as Stripe.Checkout.Session;
    if (isSubscriptionCheckoutSession(session)) return; // invoice/subscription events carry billing state
    await handleSuccessfulTipPayment(session);
    return;
  }

  if (event.type === "checkout.session.async_payment_failed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (isPhysicalQrCheckoutSession(session)) {
      await handlePhysicalQrAsyncPaymentFailed(session);
    } else {
      console.info("[stripe.webhook] checkout.session.async_payment_failed", {
        eventId: event.id,
        sessionId: session.id,
      });
    }
    return;
  }

  if (event.type === "checkout.session.expired") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (isPhysicalQrCheckoutSession(session)) {
      await handlePhysicalQrCheckoutExpired(session);
    } else {
      console.info("[stripe.webhook] checkout.session.expired", {
        eventId: event.id,
        sessionId: session.id,
        paymentStatus: session.payment_status ?? null,
      });
      recordCheckoutSessionExpired(session);
    }
    return;
  }

  if (event.type === "payment_intent.succeeded") {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    await handlePaymentSuccess(paymentIntent.id);
    return;
  }

  if (event.type === "payment_intent.payment_failed") {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    if (paymentIntent.metadata?.source === "physical_qr_order") {
      await handlePhysicalQrPaymentFailed(paymentIntent);
    } else {
      await handlePaymentFailed(paymentIntent.id);
    }
    return;
  }

  if (event.type === "payment_intent.canceled") {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    if (paymentIntent.metadata?.source === "physical_qr_order") {
      await handlePhysicalQrPaymentFailed(paymentIntent);
    } else {
      await handlePaymentFailed(paymentIntent.id);
    }
    return;
  }

  if (
    event.type === "charge.refunded" ||
    event.type === "refund.updated" ||
    event.type === "refund.created" ||
    event.type === "refund.failed"
  ) {
    const obj = event.data.object as Stripe.Charge | Stripe.Refund;
    if (event.type !== "charge.refunded") {
      const refund = obj as Stripe.Refund;
      const pi =
        typeof refund.payment_intent === "string"
          ? refund.payment_intent
          : refund.payment_intent?.id ?? null;
      const charge =
        typeof refund.charge === "string" ? refund.charge : refund.charge?.id ?? null;
      await upsertStripeRefundEvent({
        stripeRefundId: refund.id,
        stripePaymentIntentId: pi,
        stripeChargeId: charge,
        amountCents: refund.amount,
        currency: refund.currency,
        status: refund.status ?? "pending",
        reason: typeof refund.reason === "string" ? refund.reason : null,
        occurredAt: new Date((refund.created ?? Math.floor(Date.now() / 1000)) * 1000),
      });
    } else {
      const charge = obj as Stripe.Charge;
      const pi =
        typeof charge.payment_intent === "string"
          ? charge.payment_intent
          : charge.payment_intent?.id ?? null;
      const refunds = charge.refunds?.data ?? [];
      for (const refund of refunds) {
        await upsertStripeRefundEvent({
          stripeRefundId: refund.id,
          stripePaymentIntentId: pi,
          stripeChargeId: charge.id,
          amountCents: refund.amount,
          currency: refund.currency ?? charge.currency,
          status: refund.status ?? "succeeded",
          reason: typeof refund.reason === "string" ? refund.reason : null,
          occurredAt: new Date((refund.created ?? charge.created) * 1000),
        });
      }
    }
    return;
  }

  if (
    event.type === "charge.dispute.created" ||
    event.type === "charge.dispute.closed" ||
    event.type === "charge.dispute.updated"
  ) {
    const dispute = event.data.object as Stripe.Dispute;
    const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id ?? null;
    const pi =
      typeof dispute.payment_intent === "string"
        ? dispute.payment_intent
        : dispute.payment_intent?.id ?? null;
    await upsertStripeDisputeEvent({
      stripeDisputeId: dispute.id,
      stripeChargeId: chargeId,
      stripePaymentIntentId: pi,
      amountCents: dispute.amount,
      currency: dispute.currency,
      status: dispute.status,
      reason: typeof dispute.reason === "string" ? dispute.reason : null,
      occurredAt: new Date((dispute.created ?? Math.floor(Date.now() / 1000)) * 1000),
      stripeEventAccount: typeof event.account === "string" ? event.account : null,
    });
  }
}

function stripeWebhookHandler(endpoint: StripeWebhookEndpoint) {
  return async (req: Request, res: Response) => {
  const webhookReceivedAt = Date.now();
  // Each endpoint has its own signing secret. Exactly one secret is tried per endpoint.
  const webhookSecret = process.env[endpoint.secretEnv]?.trim();
  const sig = req.headers["stripe-signature"];

  if (!sig || !webhookSecret) {
    return res.status(400).send("Webhook secret or signature missing");
  }

  let event: Stripe.Event;
  try {
    event = verifyWebhookSignature(req.body as Buffer, sig, webhookSecret);
  } catch (err) {
    logServerError("stripe.webhook.verify", err, { phase: "signature_verify", endpoint: endpoint.kind });
    return res.status(400).send("Webhook signature verification failed");
  }

  if (isStripeEventModeMismatch(event, process.env.STRIPE_SECRET_KEY)) {
    console.error("[stripe.webhook] mode mismatch: event ignored", { eventId: event.id, eventType: event.type });
    return res.json({ received: true, ignored: "mode_mismatch" });
  }

  if (endpoint.kind === "connect") {
    // Connected-account endpoint: only events that happen on a connected account, and only the
    // types CareTip handles there. Everything else is acknowledged and ignored (never applied).
    const account = typeof event.account === "string" ? event.account : "";
    if (!account.startsWith("acct_")) {
      console.error("[stripe.webhook] connect endpoint received a platform event: ignored", {
        eventId: event.id,
        eventType: event.type,
      });
      return res.json({ received: true, ignored: "not_connected_account_event" });
    }
    if (!CONNECT_ENDPOINT_EVENT_TYPES.has(event.type) && !isConnectPayoutEventType(event.type)) {
      return res.json({ received: true, ignored: true });
    }
  }

  try {
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (isPhysicalQrCheckoutSession(session)) {
        let physicalResult: Awaited<ReturnType<typeof handlePhysicalQrCheckoutSessionCompleted>> | undefined;
        const outcome = await runWithStripeWebhookClaim(event, async () => {
          physicalResult = await handlePhysicalQrCheckoutSessionCompleted(session);
          // Business-rule outcomes (review, awaiting payment, duplicate) are recorded durably and
          // acknowledged. Only infrastructure failures are retried by Stripe.
          if (!physicalResult.ok && physicalResult.retryable) {
            throw new Error(`physical_qr_checkout_failed:${physicalResult.reason ?? "unknown"}`);
          }
        });
        if (outcome === "retry") {
          return res.status(503).json({ received: false, retryable: true, source: "physical_qr_order" });
        }
        if (outcome === "duplicate") {
          return res.json({ received: true, duplicate: true, source: "physical_qr_order" });
        }
        return res.json({ received: true, source: "physical_qr_order", ...physicalResult! });
      }
      if (event.type === "checkout.session.completed" && isSubscriptionCheckoutSession(session)) {
        logTrialSync("webhook.stripe_router.billing_checkout", {
          stripeEventId: event.id,
          sessionId: session.id,
          mode: session.mode,
        });
        try {
          const billingResult = await handleStripeBillingWebhookEvent(event);
          return res.json(billingResult);
        } catch (billingErr) {
          if (billingErr instanceof BillingWebhookConcurrentDeliveryError) {
            return res.status(503).json({ received: false, retryable: true });
          }
          logServerError("stripe.webhook.billing", billingErr, {
            eventId: event.id,
            eventType: event.type,
          });
          return res.status(500).json({ received: false });
        }
      }
    }

    if (isStripeBillingEventType(event.type)) {
      try {
        const billingResult = await handleStripeBillingWebhookEvent(event);
        return res.json(billingResult);
      } catch (billingErr) {
        if (billingErr instanceof BillingWebhookConcurrentDeliveryError) {
          return res.status(503).json({ received: false, retryable: true });
        }
        logServerError("stripe.webhook.billing", billingErr, {
          eventId: event.id,
          eventType: event.type,
        });
        return res.status(500).json({ received: false });
      }
    }

    if (!usesStripeWebhookEventStore(event)) {
      return res.json({ received: true, ignored: true });
    }

    const outcome = await runWithStripeWebhookClaim(event, () => dispatchNonBillingStripeEvent(event));
    if (outcome === "retry") {
      return res.status(503).json({ received: false, retryable: true });
    }
    if (outcome === "duplicate") {
      console.info("[stripe.webhook] duplicate event skipped", { eventId: event.id, type: event.type });
      return res.json({ received: true, duplicate: true });
    }
  } catch (err) {
    logServerError("stripe.webhook.handler", err, {
      phase: "event_handler",
      eventType: event.type,
      eventId: event.id,
      durationMs: Date.now() - webhookReceivedAt,
    });
    return res.status(500).json({ received: false });
  }

  console.info("[stripe.webhook] processed", {
    eventId: event.id,
    type: event.type,
    endpoint: endpoint.kind,
    durationMs: Date.now() - webhookReceivedAt,
  });
  return res.json({ received: true });
  };
}

/**
 * Platform endpoint (POST /api/webhooks/stripe): events on the CareTip platform account, verified
 * with STRIPE_WEBHOOK_SECRET.
 *
 * Connect endpoint (POST /api/webhooks/stripe-connect): events on connected accounts (account.updated,
 * payout.*, disputes), verified with STRIPE_CONNECT_WEBHOOK_SECRET. Stripe signs each Dashboard
 * endpoint with its own secret, so the two never share one. Both use the same event-claim table
 * (keyed by the globally unique Stripe event id), so an event delivered to both is processed once.
 * When STRIPE_CONNECT_WEBHOOK_SECRET is unset the Connect endpoint rejects every request (400).
 */
router.post("/stripe", stripeWebhookHandler({ kind: "platform", secretEnv: "STRIPE_WEBHOOK_SECRET" }));
router.post("/stripe-connect", stripeWebhookHandler({ kind: "connect", secretEnv: "STRIPE_CONNECT_WEBHOOK_SECRET" }));


export default router;
