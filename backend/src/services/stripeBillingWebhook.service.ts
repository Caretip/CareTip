import { SubscriptionEventProcessingResult } from "@prisma/client";
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
  retrieveStripeSubscriptionAuthoritative,
  withSubscriptionSyncLease,
} from "./subscriptionStripeSync.js";
import { PaymentOperationBusyError } from "../lib/payments/operationLease.js";
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

  const sub = await retrieveStripeSubscriptionAuthoritative(subId);
  const row = sub === "missing" ? null : await resolveSubscriptionRow(sub);
  if (sub === "missing" || !row) {
    await recordIgnoredBillingEvent({
      ctx,
      auditType: STRIPE_BILLING_AUDIT_TYPES.invoicePaymentSucceeded,
      payload: {
        reason: sub === "missing" ? "stripe_subscription_missing" : "subscription_row_not_found",
        stripeSubscriptionId: subId,
      },
    });
    return;
  }

  // A paid invoice is a payment fact, not an entitlement decision. The mirror follows the
  // subscription's current Stripe status (re-read under the business sync lease); it is never forced
  // to "active", so a late invoice event cannot revive a canceled, unpaid or incomplete subscription.
  const outcome = await activateSubscriptionMirrorFromStripeSubscription({
    businessId: row.businessId,
    sub,
    auditType: STRIPE_BILLING_AUDIT_TYPES.invoicePaymentSucceeded,
    stripeEventId: event.id,
    source: "webhook_invoice_payment_succeeded",
    billingWebhookClaimToken: ctx.claimToken,
    auditPayloadExtra: { invoiceId: invoice.id, amountPaid: invoice.amount_paid },
  });
  if (outcome === "ignored") {
    await recordIgnoredBillingEvent({
      ctx,
      auditType: STRIPE_BILLING_AUDIT_TYPES.invoicePaymentSucceeded,
      payload: { reason: "activation_ignored", invoiceId: invoice.id, stripeSubscriptionId: subId },
    });
  }

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

  const hint = await retrieveStripeSubscriptionAuthoritative(subId);
  const row = hint === "missing" ? null : await resolveSubscriptionRow(hint);
  if (hint === "missing" || !row) {
    await recordIgnoredBillingEvent({
      ctx,
      auditType: STRIPE_BILLING_AUDIT_TYPES.invoicePaymentFailed,
      payload: {
        reason: hint === "missing" ? "stripe_subscription_missing" : "subscription_row_not_found",
        stripeSubscriptionId: subId,
      },
    });
    return;
  }

  const applied = await withSubscriptionSyncLease(row.businessId, async () => {
  const sub = await retrieveStripeSubscriptionAuthoritative(subId);
  if (sub === "missing") {
    await recordIgnoredBillingEvent({
      ctx,
      auditType: STRIPE_BILLING_AUDIT_TYPES.invoicePaymentFailed,
      payload: { reason: "stripe_subscription_missing", stripeSubscriptionId: subId },
    });
    return false;
  }
  const mirror = await prisma.subscription.findUnique({
    where: { id: row.id },
    select: { stripeSubscriptionId: true },
  });
  if (mirror?.stripeSubscriptionId && mirror.stripeSubscriptionId !== sub.id) {
    // The failed invoice belongs to a subscription this business has already replaced.
    await recordIgnoredBillingEvent({
      ctx,
      auditType: STRIPE_BILLING_AUDIT_TYPES.invoicePaymentFailed,
      payload: { reason: "superseded_subscription", stripeSubscriptionId: subId },
    });
    return false;
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
    return false;
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
  return true;
  });
  if (!applied) return;

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
    await deferBillingEventWhileDisabled(event);
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
      try {
        await runWithFailureRecording(
          STRIPE_BILLING_AUDIT_TYPES.checkoutSessionCompleted,
          { eventType: event.type },
          async () => {
            await handleSubscriptionCheckoutCompleted(ctx, event, session);
          },
        );
      } catch (err) {
        if (err instanceof PaymentOperationBusyError) throw new BillingWebhookConcurrentDeliveryError(event.id);
        throw err;
      }
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

  try {
    await runWithFailureRecording(event.type, { eventType: event.type }, async () => {
      await dispatchBillingEvent(ctx, event);
      await assertBillingWebhookClaimFinalized(ctx);
    });
  } catch (err) {
    if (err instanceof PaymentOperationBusyError) throw new BillingWebhookConcurrentDeliveryError(event.id);
    throw err;
  }

  return { received: true };
}

/** Reason stored on a deferred event; the claim service treats it as retryable. */
export const BILLING_DISABLED_DEFERRED_REASON = "billing_disabled_deferred";

/**
 * While SUBSCRIPTION_BILLING_ENABLED is off, verified billing events are recorded (event id + type,
 * no payload) as retryable-ignored instead of being dropped. `replayDeferredBillingEvents` re-fetches
 * them from Stripe and processes them once billing is enabled again. Idempotent: the event id is
 * unique, and an event that was already processed is never downgraded to deferred.
 */
async function deferBillingEventWhileDisabled(event: Stripe.Event): Promise<void> {
  const existing = await prisma.subscriptionEvent.findUnique({
    where: { stripeEventId: event.id },
    select: { id: true },
  });
  if (existing) return; // redelivery, or already processed before billing was turned off
  try {
    await prisma.subscriptionEvent.create({
      data: {
        subscriptionId: null,
        auditType: event.type,
        type: event.type,
        stripeEventId: event.id,
        processingResult: SubscriptionEventProcessingResult.ignored,
        payload: { reason: BILLING_DISABLED_DEFERRED_REASON, eventType: event.type },
        occurredAt: new Date((event.created ?? Math.floor(Date.now() / 1000)) * 1000),
      },
    });
  } catch (err) {
    if ((err as { code?: string })?.code !== "P2002") throw err;
  }
}

type RetrieveEventFn = (id: string) => Promise<Stripe.Event>;
let retrieveEventFnForTests: RetrieveEventFn | null = null;
export function __setRetrieveStripeEventFnForTests(fn: RetrieveEventFn | null): void {
  retrieveEventFnForTests = fn;
}

/** Stripe keeps events for 30 days; older deferred events cannot be replayed. */
const DEFERRED_EVENT_MAX_AGE_MS = 29 * 24 * 60 * 60_000;

export async function replayDeferredBillingEvents(limit = 50): Promise<{
  replayed: number;
  failed: number;
  expired: number;
  skipped: "billing_disabled" | null;
}> {
  if (!isSubscriptionBillingEnabled()) return { replayed: 0, failed: 0, expired: 0, skipped: "billing_disabled" };
  const rows = await prisma.subscriptionEvent.findMany({
    where: {
      processingResult: SubscriptionEventProcessingResult.ignored,
      payload: { path: ["reason"], equals: BILLING_DISABLED_DEFERRED_REASON },
      stripeEventId: { not: null },
    },
    orderBy: { occurredAt: "asc" },
    take: limit,
    select: { id: true, stripeEventId: true, occurredAt: true },
  });
  let replayed = 0;
  let failed = 0;
  let expired = 0;
  for (const row of rows) {
    if (Date.now() - row.occurredAt.getTime() > DEFERRED_EVENT_MAX_AGE_MS) {
      await prisma.subscriptionEvent.update({
        where: { id: row.id },
        data: { payload: { reason: "billing_disabled_deferred_expired" } },
      });
      expired += 1;
      continue;
    }
    try {
      const event = retrieveEventFnForTests
        ? await retrieveEventFnForTests(row.stripeEventId!)
        : await getStripeClient().events.retrieve(row.stripeEventId!);
      await handleStripeBillingWebhookEvent(event);
      replayed += 1;
    } catch (err) {
      failed += 1;
      logTrialSync("billing_replay.failed", {
        stripeEventId: row.stripeEventId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { replayed, failed, expired, skipped: null };
}
