import { Router, type Request, type Response } from "express";
import Stripe from "stripe";
import {
  verifyWebhookSignature,
  handleSuccessfulTipPayment,
  handlePaymentSuccess,
  handlePaymentFailed,
} from "../services/stripe.service.js";
import {
  handleStripeBillingWebhookEvent,
  isStripeBillingEventType,
  isSubscriptionCheckoutSession,
} from "../services/stripeBillingWebhook.service.js";
import { handleConnectAccountUpdated } from "../services/stripeConnect.service.js";
import {
  handleConnectPayoutEvent,
  isConnectPayoutEventType,
} from "../services/stripeConnectPayout.service.js";
import {
  isStripeWebhookEventProcessed,
  markStripeWebhookEventProcessed,
} from "../services/stripeWebhookIdempotency.service.js";
import { recordCheckoutSessionExpired } from "../services/checkoutFunnelMetrics.service.js";
import { logTrialSync } from "../lib/subscription/trialSyncDebugLog.js";
import { logServerError } from "../utils/httpErrors.js";
import {
  upsertStripeRefundEvent,
  upsertStripeDisputeEvent,
} from "../services/finance/tipRefunds.service.js";

/**
 * POST /api/webhooks/stripe (mounted at /api/webhooks + /stripe)
 * Raw body required — registered in index.ts with express.raw({ type: "application/json" }).
 */
const router = Router();

const TIP_EVENT_TYPES = new Set([
  "checkout.session.expired",
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

router.post("/stripe", async (req: Request, res: Response) => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const sig = req.headers["stripe-signature"];

  if (!sig || !webhookSecret) {
    return res.status(400).send("Webhook secret or signature missing");
  }

  let event: Stripe.Event;
  try {
    event = verifyWebhookSignature(req.body as Buffer, sig);
  } catch (err) {
    logServerError("stripe.webhook.verify", err, { phase: "signature_verify" });
    return res.status(400).send("Webhook signature verification failed");
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (isSubscriptionCheckoutSession(session)) {
        logTrialSync("webhook.stripe_router.billing_checkout", {
          stripeEventId: event.id,
          sessionId: session.id,
          mode: session.mode,
        });
        const billingResult = await handleStripeBillingWebhookEvent(event);
        return res.json(billingResult);
      }
    }

    if (isStripeBillingEventType(event.type)) {
      const billingResult = await handleStripeBillingWebhookEvent(event);
      return res.json(billingResult);
    }

    if (await isStripeWebhookEventProcessed(event.id)) {
      console.info("[stripe.webhook] duplicate event skipped", { eventId: event.id, type: event.type });
      return res.json({ received: true, duplicate: true });
    }

    if (event.type === "account.updated") {
      const account = event.data.object as Stripe.Account;
      await handleConnectAccountUpdated(account, { eventCreatedUnix: event.created });
      // Mark only after handler completes so Stripe can retry on failure.
      await markStripeWebhookEventProcessed(event.id, event.type);
      return res.json({ received: true });
    }

    if (isConnectPayoutEventType(event.type)) {
      await handleConnectPayoutEvent(event);
      // Unmatched accounts are a successful observation (no attach). Mark after handler
      // so thrown errors remain retryable.
      await markStripeWebhookEventProcessed(event.id, event.type);
      return res.json({ received: true });
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      console.log("stripe.webhook: checkout.session.completed → handleSuccessfulTipPayment", {
        eventId: event.id,
        sessionId: session.id,
        mode: session.mode,
      });
      await handleSuccessfulTipPayment(session);
    }
    if (event.type === "checkout.session.expired") {
      const session = event.data.object as Stripe.Checkout.Session;
      console.info("[stripe.webhook] checkout.session.expired", {
        eventId: event.id,
        sessionId: session.id,
        paymentStatus: session.payment_status ?? null,
      });
      recordCheckoutSessionExpired(session);
    }
    if (event.type === "payment_intent.succeeded") {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      await handlePaymentSuccess(paymentIntent.id);
    }
    if (event.type === "payment_intent.payment_failed") {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      await handlePaymentFailed(paymentIntent.id);
    }
    if (event.type === "payment_intent.canceled") {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      await handlePaymentFailed(paymentIntent.id);
    }

    if (event.type === "charge.refunded" || event.type === "refund.updated") {
      const obj = event.data.object as Stripe.Charge | Stripe.Refund;
      if (event.type === "refund.updated") {
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
      });
    }

    if (
      TIP_EVENT_TYPES.has(event.type) ||
      event.type === "checkout.session.completed" ||
      CONNECT_EVENT_TYPES.has(event.type)
    ) {
      await markStripeWebhookEventProcessed(event.id, event.type);
    }
  } catch (err) {
    logServerError("stripe.webhook.handler", err, {
      phase: "event_handler",
      eventType: event.type,
      eventId: event.id,
    });
    return res.status(500).json({ received: false });
  }

  res.json({ received: true });
});

export default router;
