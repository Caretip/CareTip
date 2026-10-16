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
  handlePhysicalQrCheckoutExpired,
  handlePhysicalQrCheckoutSessionCompleted,
  handlePhysicalQrPaymentFailed,
} from "../services/physicalQr/physicalQrWebhook.service.js";

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

router.post("/stripe", async (req: Request, res: Response) => {
  const webhookReceivedAt = Date.now();
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
      if (isPhysicalQrCheckoutSession(session)) {
        let physicalResult: Awaited<ReturnType<typeof handlePhysicalQrCheckoutSessionCompleted>> | undefined;
        const outcome = await runWithStripeWebhookClaim(event, async () => {
          physicalResult = await handlePhysicalQrCheckoutSessionCompleted(session);
          if (!physicalResult.ok) {
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
      if (isSubscriptionCheckoutSession(session)) {
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
    durationMs: Date.now() - webhookReceivedAt,
  });
  return res.json({ received: true });
});

export default router;
