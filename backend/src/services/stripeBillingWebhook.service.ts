import { SubscriptionStatus } from "@prisma/client";
import type Stripe from "stripe";
import { isSubscriptionBillingEnabled } from "../config/featureFlags.js";
import { BILLING_CHECKOUT_METADATA_KEYS, STRIPE_BILLING_AUDIT_TYPES } from "../lib/subscription/subscriptionAuditTypes.js";
import { isSubscriptionMirrorEntitled } from "../lib/subscription/subscriptionMirrorEntitlement.js";
import { mapStripeSubscriptionStatus } from "../lib/subscription/mapStripeSubscriptionStatus.js";
import { getStripeClient } from "./stripe.service.js";
import { prisma } from "../prisma.js";
import {
  applyStripeMirrorTransactional,
  buildMirrorSnapshotFromStripeSubscription,
  downgradeToInternalBasic,
  findSubscriptionForStripeBilling,
} from "./subscription.service.js";
import { activateSubscriptionMirrorFromStripeSubscription } from "./subscriptionActivation.service.js";
import { BillingWebhookConcurrentDeliveryError } from "./billingWebhookIdempotency.service.js";
import {
  acquireBillingWebhookProcessingClaim,
  finalizeBillingWebhookClaimFailed,
  finalizeBillingWebhookClaimIgnored,
  isBillingWebhookClaimStillOwned,
} from "./billingWebhookProcessingClaim.service.js";
import { logTrialSync } from "../lib/subscription/trialSyncDebugLog.js";
import {
  handleSubscriptionInvoicePaymentFailedNotification,
  supersedeSubscriptionPaymentFailedNotificationsForInvoice,
} from "./subscriptionPaymentFailedNotification.service.js";

const BILLING_EVENT_TYPES = new Set<string>([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
]);

export type BillingWebhookHandlerContext = {
  stripeEventId: string;
  claimToken: string;
};

export function isStripeBillingEventType(eventType: string): boolean {
  return BILLING_EVENT_TYPES.has(eventType);
}

export function isSubscriptionCheckoutSession(session: Stripe.Checkout.Session): boolean {
  return session.mode === "subscription";
}

async function recordIgnoredBillingEvent(params: {
  ctx: BillingWebhookHandlerContext;
  auditType: string;
  payload: Record<string, unknown>;
  subscriptionId?: string | null;
}): Promise<void> {
  const finalized = await finalizeBillingWebhookClaimIgnored({
    stripeEventId: params.ctx.stripeEventId,
    claimToken: params.ctx.claimToken,
    auditType: params.auditType,
    payload: params.payload,
    subscriptionId: params.subscriptionId,
  });
  if (!finalized) {
    logTrialSync("webhook.finalize_ignored_stale_owner", {
      stripeEventId: params.ctx.stripeEventId,
    });
  }
}

async function recordFailedBillingEvent(params: {
  ctx: BillingWebhookHandlerContext;
  auditType: string;
  payload: Record<string, unknown>;
  error: unknown;
  subscriptionId?: string | null;
}): Promise<void> {
  if (!(await isBillingWebhookClaimStillOwned(params.ctx.stripeEventId, params.ctx.claimToken))) {
    return;
  }
  await finalizeBillingWebhookClaimFailed({
    stripeEventId: params.ctx.stripeEventId,
    claimToken: params.ctx.claimToken,
    auditType: params.auditType,
    payload: params.payload,
    error: params.error,
    subscriptionId: params.subscriptionId,
  });
}

async function assertBillingWebhookClaimFinalized(ctx: BillingWebhookHandlerContext): Promise<void> {
  if (await isBillingWebhookClaimStillOwned(ctx.stripeEventId, ctx.claimToken)) {
    throw new Error("Billing webhook processing claim was not finalized");
  }
}

function subscriptionIdFromStripeObject(
  sub: string | Stripe.Subscription | null | undefined,
): string | null {
  if (!sub) return null;
  return typeof sub === "string" ? sub : sub.id;
}

function customerIdFromStripeObject(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined,
): string | null {
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id ?? null;
}

function metadataLookup(md: Stripe.Metadata | null | undefined) {
  return {
    caretipBusinessId: md?.[BILLING_CHECKOUT_METADATA_KEYS.businessId] ?? null,
    caretipSubscriptionId: md?.[BILLING_CHECKOUT_METADATA_KEYS.subscriptionId] ?? null,
    caretipPlanKey: md?.[BILLING_CHECKOUT_METADATA_KEYS.planKey] ?? null,
  };
}

async function resolveSubscriptionRow(sub: Stripe.Subscription) {
  const md = sub.metadata ?? {};
  const meta = metadataLookup(md);
  return findSubscriptionForStripeBilling({
    stripeSubscriptionId: sub.id,
    stripeCustomerId: customerIdFromStripeObject(sub.customer),
    caretipBusinessId: meta.caretipBusinessId,
    caretipSubscriptionId: meta.caretipSubscriptionId,
  });
}

async function handleSubscriptionLifecycleEvent(
  ctx: BillingWebhookHandlerContext,
  event: Stripe.Event,
  sub: Stripe.Subscription,
  auditType: (typeof STRIPE_BILLING_AUDIT_TYPES)[keyof typeof STRIPE_BILLING_AUDIT_TYPES],
  source:
    | "webhook_subscription_created"
    | "webhook_subscription_updated"
    | "webhook_subscription_deleted",
): Promise<void> {
  const meta = metadataLookup(sub.metadata);
  const businessId = meta.caretipBusinessId;
  if (!businessId) {
    logTrialSync("webhook.subscription_lifecycle.stop", {
      source,
      outcome: "ignored",
      reason: "missing_caretipBusinessId_on_subscription",
      stripeSubscriptionId: sub.id,
      stripeEventId: event.id,
    });
    await recordIgnoredBillingEvent({
      ctx,
      auditType,
      payload: { reason: "missing_caretipBusinessId", stripeSubscriptionId: sub.id },
    });
    return;
  }

  const outcome = await activateSubscriptionMirrorFromStripeSubscription({
    businessId,
    sub,
    auditType,
    stripeEventId: event.id,
    source,
    billingWebhookClaimToken: ctx.claimToken,
  });

  if (outcome === "ignored") {
    await recordIgnoredBillingEvent({
      ctx,
      auditType,
      payload: { reason: "activation_ignored", stripeSubscriptionId: sub.id, source },
    });
  }
}

async function handleInvoicePaymentSucceeded(
  ctx: BillingWebhookHandlerContext,
  event: Stripe.Event,
  invoice: Stripe.Invoice,
): Promise<void> {
  const subId = subscriptionIdFromStripeObject(invoice.subscription);
  if (!subId) {
    await recordIgnoredBillingEvent({
      ctx,
      auditType: STRIPE_BILLING_AUDIT_TYPES.invoicePaymentSucceeded,
      payload: { reason: "no_subscription_on_invoice", invoiceId: invoice.id },
    });
    return;
  }

  const stripe = getStripeClient();
  const sub = await stripe.subscriptions.retrieve(subId);
  const row = await resolveSubscriptionRow(sub);
  if (!row) {
    await recordIgnoredBillingEvent({
      ctx,
      auditType: STRIPE_BILLING_AUDIT_TYPES.invoicePaymentSucceeded,
      payload: { reason: "subscription_row_not_found", stripeSubscriptionId: subId },
    });
    return;
  }

  const snapshot = buildMirrorSnapshotFromStripeSubscription(sub);
  if (snapshot.status !== SubscriptionStatus.active && snapshot.status !== SubscriptionStatus.trialing) {
    snapshot.status = SubscriptionStatus.active;
  }

  await applyStripeMirrorTransactional({
    subscriptionRowId: row.id,
    businessId: row.businessId,
    snapshot,
    auditType: STRIPE_BILLING_AUDIT_TYPES.invoicePaymentSucceeded,
    stripeEventId: event.id,
    auditPayload: {
      invoiceId: invoice.id,
      amountPaid: invoice.amount_paid,
      stripeSubscriptionId: subId,
    },
    billingWebhookClaimToken: ctx.claimToken,
  });

  await supersedeSubscriptionPaymentFailedNotificationsForInvoice(invoice.id);
}

async function handleInvoicePaymentFailed(
  ctx: BillingWebhookHandlerContext,
  event: Stripe.Event,
  invoice: Stripe.Invoice,
): Promise<void> {
  const subId = subscriptionIdFromStripeObject(invoice.subscription);
  if (!subId) {
    await recordIgnoredBillingEvent({
      ctx,
      auditType: STRIPE_BILLING_AUDIT_TYPES.invoicePaymentFailed,
      payload: { reason: "no_subscription_on_invoice", invoiceId: invoice.id },
    });
    return;
  }

  const stripe = getStripeClient();
  const sub = await stripe.subscriptions.retrieve(subId);
  const row = await resolveSubscriptionRow(sub);
  if (!row) {
    await recordIgnoredBillingEvent({
      ctx,
      auditType: STRIPE_BILLING_AUDIT_TYPES.invoicePaymentFailed,
      payload: { reason: "subscription_row_not_found", stripeSubscriptionId: subId },
    });
    return;
  }

  const snapshot = buildMirrorSnapshotFromStripeSubscription(sub);
  const mapped = mapStripeSubscriptionStatus(sub.status);
  snapshot.status = mapped.status;

  const entitled = isSubscriptionMirrorEntitled({
    status: snapshot.status,
    cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
    cancellationEffective: snapshot.cancellationEffective,
    currentPeriodEnd: snapshot.currentPeriodEnd,
    canceledAt: snapshot.canceledAt,
  });

  if (!entitled) {
    await downgradeToInternalBasic({
      subscriptionRowId: row.id,
      businessId: row.businessId,
      auditType: STRIPE_BILLING_AUDIT_TYPES.invoicePaymentFailed,
      stripeEventId: event.id,
      auditPayload: {
        invoiceId: invoice.id,
        attemptCount: invoice.attempt_count,
        stripeSubscriptionId: subId,
        status: snapshot.status,
      },
      reason: "invoice_payment_failed_final",
      billingWebhookClaimToken: ctx.claimToken,
    });
    return;
  }

  await applyStripeMirrorTransactional({
    subscriptionRowId: row.id,
    businessId: row.businessId,
    snapshot,
    auditType: STRIPE_BILLING_AUDIT_TYPES.invoicePaymentFailed,
    stripeEventId: event.id,
    auditPayload: {
      invoiceId: invoice.id,
      attemptCount: invoice.attempt_count,
      stripeSubscriptionId: subId,
      status: snapshot.status,
    },
    billingWebhookClaimToken: ctx.claimToken,
  });

  await handleSubscriptionInvoicePaymentFailedNotification({
    businessId: row.businessId,
    subscriptionId: row.id,
    stripeInvoiceId: invoice.id,
    stripeEventId: event.id,
    stripeSubscriptionId: subId,
    invoiceAttemptCount: invoice.attempt_count ?? 1,
  });
}

async function handleSubscriptionCheckoutCompleted(
  ctx: BillingWebhookHandlerContext,
  event: Stripe.Event,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const md = session.metadata ?? {};
  const meta = metadataLookup(md);
  const stripeSubId = subscriptionIdFromStripeObject(session.subscription);

  logTrialSync("webhook.checkout_completed.start", {
    stripeEventId: event.id,
    sessionId: session.id,
    stripeSubscriptionId: stripeSubId,
    caretipBusinessId: meta.caretipBusinessId,
    caretipSubscriptionId: meta.caretipSubscriptionId,
    caretipPlanKey: meta.caretipPlanKey,
    mirrorExisted: Boolean(
      await findSubscriptionForStripeBilling({
        stripeSubscriptionId: stripeSubId,
        stripeCustomerId: customerIdFromStripeObject(session.customer),
        caretipBusinessId: meta.caretipBusinessId,
        caretipSubscriptionId: meta.caretipSubscriptionId,
      }),
    ),
  });

  if (!meta.caretipBusinessId) {
    logTrialSync("webhook.checkout_completed.stop", {
      outcome: "ignored",
      reason: "missing_caretipBusinessId_on_session",
      sessionId: session.id,
    });
    await recordIgnoredBillingEvent({
      ctx,
      auditType: STRIPE_BILLING_AUDIT_TYPES.checkoutSessionCompleted,
      payload: { reason: "missing_caretipBusinessId", sessionId: session.id },
    });
    return;
  }

  if (!stripeSubId) {
    logTrialSync("webhook.checkout_completed.stop", {
      outcome: "ignored",
      reason: "missing_stripe_subscription_on_session",
      sessionId: session.id,
    });
    await recordIgnoredBillingEvent({
      ctx,
      auditType: STRIPE_BILLING_AUDIT_TYPES.checkoutSessionCompleted,
      payload: { reason: "missing_stripe_subscription", sessionId: session.id },
    });
    return;
  }

  const stripe = getStripeClient();
  const sub = await stripe.subscriptions.retrieve(stripeSubId);
  const outcome = await activateSubscriptionMirrorFromStripeSubscription({
    businessId: meta.caretipBusinessId,
    sub,
    auditType: STRIPE_BILLING_AUDIT_TYPES.checkoutSessionCompleted,
    stripeEventId: event.id,
    source: "webhook_checkout_completed",
    billingWebhookClaimToken: ctx.claimToken,
  });

  if (outcome === "ignored") {
    await recordIgnoredBillingEvent({
      ctx,
      auditType: STRIPE_BILLING_AUDIT_TYPES.checkoutSessionCompleted,
      payload: { reason: "activation_ignored", sessionId: session.id, outcome },
    });
  }
}

async function dispatchBillingEvent(ctx: BillingWebhookHandlerContext, event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "customer.subscription.created": {
      const sub = event.data.object as Stripe.Subscription;
      await handleSubscriptionLifecycleEvent(
        ctx,
        event,
        sub,
        STRIPE_BILLING_AUDIT_TYPES.subscriptionCreated,
        "webhook_subscription_created",
      );
      return;
    }
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      await handleSubscriptionLifecycleEvent(
        ctx,
        event,
        sub,
        STRIPE_BILLING_AUDIT_TYPES.subscriptionUpdated,
        "webhook_subscription_updated",
      );
      return;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      await handleSubscriptionLifecycleEvent(
        ctx,
        event,
        sub,
        STRIPE_BILLING_AUDIT_TYPES.subscriptionDeleted,
        "webhook_subscription_deleted",
      );
      return;
    }
    case "invoice.payment_succeeded": {
      await handleInvoicePaymentSucceeded(ctx, event, event.data.object as Stripe.Invoice);
      return;
    }
    case "invoice.payment_failed": {
      await handleInvoicePaymentFailed(ctx, event, event.data.object as Stripe.Invoice);
      return;
    }
    default:
      return;
  }
}

/**
 * Process a Stripe billing webhook event with subscription_events idempotency.
 * Durable `processing` claim held until handler finalizes processed | ignored | failed.
 */
export async function handleStripeBillingWebhookEvent(
  event: Stripe.Event,
): Promise<{ received: true; duplicate?: boolean; billingDisabled?: boolean }> {
  logTrialSync("webhook.dispatch", { stripeEventId: event.id, type: event.type });

  if (!isSubscriptionBillingEnabled()) {
    logTrialSync("webhook.dispatch.stop", { reason: "billing_disabled" });
    return { received: true, billingDisabled: true };
  }

  let claim: Awaited<ReturnType<typeof acquireBillingWebhookProcessingClaim>>;
  try {
    claim = await acquireBillingWebhookProcessingClaim(event.id);
  } catch (err) {
    if (err instanceof BillingWebhookConcurrentDeliveryError) {
      throw err;
    }
    throw err;
  }

  if (claim.action === "duplicate") {
    logTrialSync("webhook.dispatch.stop", {
      reason: "duplicate",
      stripeEventId: event.id,
      processingResult: claim.processingResult,
    });
    return { received: true, duplicate: true };
  }

  const ctx: BillingWebhookHandlerContext = {
    stripeEventId: event.id,
    claimToken: claim.claimToken,
  };

  const runWithFailureRecording = async (
    auditType: string,
    payload: Record<string, unknown>,
    fn: () => Promise<void>,
  ): Promise<void> => {
    try {
      await fn();
      await assertBillingWebhookClaimFinalized(ctx);
    } catch (err) {
      await recordFailedBillingEvent({
        ctx,
        auditType,
        payload,
        error: err,
      });
      throw err;
    }
  };

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (isSubscriptionCheckoutSession(session)) {
      await runWithFailureRecording(
        STRIPE_BILLING_AUDIT_TYPES.checkoutSessionCompleted,
        { eventType: event.type },
        async () => {
          await handleSubscriptionCheckoutCompleted(ctx, event, session);
        },
      );
      return { received: true };
    }
  }

  if (!isStripeBillingEventType(event.type)) {
    await recordIgnoredBillingEvent({
      ctx,
      auditType: event.type,
      payload: { reason: "not_billing_event_type", eventType: event.type },
    });
    return { received: true };
  }

  await runWithFailureRecording(event.type, { eventType: event.type }, async () => {
    await dispatchBillingEvent(ctx, event);
    await assertBillingWebhookClaimFinalized(ctx);
  });

  return { received: true };
}
