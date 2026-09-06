import { SubscriptionEventProcessingResult } from "@prisma/client";
import type Stripe from "stripe";
import { mapStripePriceToPlanKey } from "../lib/subscription/mapStripePriceToPlanKey.js";
import type { SubscriptionPlanKey } from "@prisma/client";
import { STRIPE_BILLING_AUDIT_TYPES, BILLING_CHECKOUT_METADATA_KEYS } from "../lib/subscription/subscriptionAuditTypes.js";
import { checkoutSessionBoundToBusiness } from "../lib/subscription/checkoutSessionOwnership.js";
import { isSubscriptionMirrorEntitled } from "../lib/subscription/subscriptionMirrorEntitlement.js";
import { logTrialSync } from "../lib/subscription/trialSyncDebugLog.js";
import { prisma } from "../prisma.js";
import { isSubscriptionBillingEnabled } from "../config/featureFlags.js";
import { getStripeClient, isStripeConfigured } from "./stripe.service.js";
import {
  applyStripeMirrorTransactional,
  buildMirrorSnapshotFromStripeSubscription,
  downgradeToInternalBasic,
  ensureInitialSubscriptionMirrorFromStripe,
  findSubscriptionForStripeBilling,
  isInternalBasicSubscription,
  type SubscriptionAuditType,
} from "./subscription.service.js";

export type SubscriptionActivationSource =
  | "webhook_checkout_completed"
  | "webhook_subscription_created"
  | "webhook_subscription_updated"
  | "webhook_subscription_deleted"
  | "checkout_return_sync";

export type SubscriptionActivationOutcome =
  | "mirror_created"
  | "mirror_updated"
  | "mirror_removed"
  | "ignored"
  | "no_stripe_subscription"
  | "billing_disabled"
  | "stripe_not_configured";

function metadataLookup(md: Stripe.Metadata | null | undefined) {
  return {
    caretipBusinessId: md?.[BILLING_CHECKOUT_METADATA_KEYS.businessId] ?? null,
    caretipSubscriptionId: md?.[BILLING_CHECKOUT_METADATA_KEYS.subscriptionId] ?? null,
    caretipPlanKey: md?.[BILLING_CHECKOUT_METADATA_KEYS.planKey] ?? null,
  };
}

function customerIdFromStripeObject(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined,
): string | null {
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id ?? null;
}

function subscriptionIdFromStripeObject(
  sub: string | Stripe.Subscription | null | undefined,
): string | null {
  if (!sub) return null;
  return typeof sub === "string" ? sub : sub.id;
}

function planKeyFromStripeSubscription(sub: Stripe.Subscription): SubscriptionPlanKey | null {
  const fromMeta = metadataLookup(sub.metadata).caretipPlanKey;
  if (fromMeta === "basic" || fromMeta === "premium" || fromMeta === "enterprise") {
    return fromMeta;
  }
  const price = sub.items?.data?.[0]?.price;
  if (!price) return null;
  try {
    return mapStripePriceToPlanKey(typeof price === "string" ? price : price);
  } catch {
    return null;
  }
}

function pickEntitledSubscriptionForBusiness(
  subs: Stripe.Subscription[],
  businessId: string,
  expectedPlanKey?: SubscriptionPlanKey,
): Stripe.Subscription | null {
  const owned = subs.filter((s) => {
    const metaId = metadataLookup(s.metadata).caretipBusinessId;
    return !metaId || metaId === businessId;
  });

  const entitled = owned.filter((s) => {
    if (s.status === "trialing" || s.status === "active" || s.status === "past_due") {
      return true;
    }
    return false;
  });

  if (expectedPlanKey) {
    const planMatched = entitled.filter((s) => planKeyFromStripeSubscription(s) === expectedPlanKey);
    const pool = planMatched.length > 0 ? planMatched : entitled;
    return (
      pool.find((s) => s.status === "trialing") ??
      pool.find((s) => s.status === "active") ??
      pool[0] ??
      null
    );
  }

  const sorted = [...entitled].sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
  return (
    sorted.find((s) => s.status === "trialing") ??
    sorted.find((s) => s.status === "active") ??
    sorted[0] ??
    null
  );
}

async function resolveSubscriptionRow(sub: Stripe.Subscription) {
  const meta = metadataLookup(sub.metadata);
  return findSubscriptionForStripeBilling({
    stripeSubscriptionId: sub.id,
    stripeCustomerId: customerIdFromStripeObject(sub.customer),
    caretipBusinessId: meta.caretipBusinessId,
    caretipSubscriptionId: meta.caretipSubscriptionId,
  });
}

/**
 * Authoritative mirror activation from a Stripe Subscription object.
 * Used by billing webhooks and checkout-return sync (same code path).
 */
export async function activateSubscriptionMirrorFromStripeSubscription(params: {
  businessId: string;
  sub: Stripe.Subscription;
  auditType: SubscriptionAuditType;
  stripeEventId: string;
  source: SubscriptionActivationSource;
}): Promise<SubscriptionActivationOutcome> {
  const { sub, auditType, stripeEventId, source } = params;

  logTrialSync("activation.start", {
    source,
    auditType,
    stripeEventId,
    businessId: params.businessId,
    stripeSubscriptionId: sub.id,
    stripeStatus: sub.status,
    subscriptionMetadata: sub.metadata ?? {},
  });

  const snapshot = buildMirrorSnapshotFromStripeSubscription(sub);
  const auditPayload = {
    source,
    stripeSubscriptionId: sub.id,
    stripeStatus: sub.status,
    planKey: snapshot.planKey,
    status: snapshot.status,
    cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
    cancellationEffective: snapshot.cancellationEffective?.toISOString() ?? null,
  };

  const meta = metadataLookup(sub.metadata);
  const resolvedBusinessId = meta.caretipBusinessId ?? params.businessId;
  if (meta.caretipBusinessId && meta.caretipBusinessId !== params.businessId) {
    logTrialSync("activation.stop", {
      source,
      outcome: "ignored",
      reason: "business_metadata_mismatch",
      expectedBusinessId: params.businessId,
      metadataBusinessId: meta.caretipBusinessId,
    });
    return "ignored";
  }

  let row = await resolveSubscriptionRow(sub);

  if (!row) {
    if (!isSubscriptionMirrorEntitled(snapshot)) {
      logTrialSync("activation.stop", {
        source,
        outcome: "ignored",
        reason: "subscription_not_entitled_on_create",
        stripeSubscriptionId: sub.id,
      });
      return "ignored";
    }

    const ensured = await ensureInitialSubscriptionMirrorFromStripe({
      businessId: resolvedBusinessId,
      snapshot,
      auditType,
      stripeEventId,
      auditPayload,
    });
    row = { id: ensured.id, businessId: ensured.businessId };

    if (ensured.created) {
      logTrialSync("activation.mirror_created", {
        source,
        businessId: row.businessId,
        subscriptionRowId: row.id,
        planKey: snapshot.planKey,
        status: snapshot.status,
      });
      return "mirror_created";
    }
  }

  if (!isSubscriptionMirrorEntitled(snapshot)) {
    await downgradeToInternalBasic({
      subscriptionRowId: row.id,
      businessId: row.businessId,
      auditType,
      stripeEventId,
      auditPayload,
      reason: "stripe_subscription_ended",
    });
    logTrialSync("activation.mirror_downgraded_to_basic", {
      source,
      businessId: row.businessId,
      subscriptionRowId: row.id,
    });
    return "mirror_removed";
  }

  await applyStripeMirrorTransactional({
    subscriptionRowId: row.id,
    businessId: row.businessId,
    snapshot,
    auditType,
    stripeEventId,
    auditPayload,
  });

  logTrialSync("activation.mirror_updated", {
    source,
    businessId: row.businessId,
    subscriptionRowId: row.id,
    planKey: snapshot.planKey,
    status: snapshot.status,
  });
  return "mirror_updated";
}

/**
 * When Option A mirror is missing after checkout, resolve the Stripe subscription
 * for this business and run the same activation path as webhooks.
 */
export async function tryActivateSubscriptionFromStripeForBusiness(params: {
  businessId: string;
  checkoutSessionId?: string | null;
  expectedPlanKey?: SubscriptionPlanKey;
  source?: SubscriptionActivationSource;
}): Promise<SubscriptionActivationOutcome> {
  const source = params.source ?? "checkout_return_sync";

  if (!isSubscriptionBillingEnabled()) {
    return "billing_disabled";
  }
  if (!isStripeConfigured()) {
    return "stripe_not_configured";
  }

  const internalMirror = await prisma.subscription.findUnique({
    where: { businessId: params.businessId },
    select: {
      planKey: true,
      status: true,
      stripeSubscriptionId: true,
      isTrial: true,
    },
  });
  if (internalMirror && isInternalBasicSubscription(internalMirror)) {
    logTrialSync("activation.stop", {
      source,
      outcome: "ignored",
      reason: "internal_basic_no_stripe_sync",
      businessId: params.businessId,
    });
    return "ignored";
  }

  const stripe = getStripeClient();
  let sub: Stripe.Subscription | null = null;

  if (params.checkoutSessionId) {
    const session = await stripe.checkout.sessions.retrieve(params.checkoutSessionId, {
      expand: ["subscription"],
    });
    const sessionMeta = metadataLookup(session.metadata);
    if (!checkoutSessionBoundToBusiness(session, params.businessId)) {
      logTrialSync("activation.checkout_session.skip", {
        reason: sessionMeta.caretipBusinessId
          ? "session_business_mismatch"
          : "session_business_metadata_missing",
        checkoutSessionId: params.checkoutSessionId,
      });
      return "ignored";
    }
    const subId = subscriptionIdFromStripeObject(session.subscription);
    if (subId) {
      sub =
        typeof session.subscription === "string"
          ? await stripe.subscriptions.retrieve(subId, { expand: ["items.data.price"] })
          : (session.subscription as Stripe.Subscription);
    }
  }

  if (!sub) {
    const business = await prisma.business.findUnique({
      where: { id: params.businessId },
      select: { stripeCustomerId: true },
    });
    if (!business?.stripeCustomerId) {
      return "no_stripe_subscription";
    }
    const list = await stripe.subscriptions.list({
      customer: business.stripeCustomerId,
      status: "all",
      limit: 10,
      expand: ["data.items.data.price"],
    });
    sub = pickEntitledSubscriptionForBusiness(
      list.data,
      params.businessId,
      params.expectedPlanKey,
    );
  }

  if (!sub) {
    logTrialSync("activation.stop", {
      source,
      outcome: "no_stripe_subscription",
      businessId: params.businessId,
    });
    return "no_stripe_subscription";
  }

  const stripeEventId = `checkout_return_sync_${params.checkoutSessionId ?? sub.id}_${Date.now()}`;
  return activateSubscriptionMirrorFromStripeSubscription({
    businessId: params.businessId,
    sub,
    auditType: STRIPE_BILLING_AUDIT_TYPES.checkoutSessionCompleted,
    stripeEventId,
    source,
  });
}

/** Allow re-processing webhooks that were ignored before Option A create-on-first shipped. */
export async function clearRetryableIgnoredBillingWebhook(stripeEventId: string): Promise<boolean> {
  const row = await prisma.subscriptionEvent.findUnique({
    where: { stripeEventId },
    select: { processingResult: true, payload: true },
  });
  if (!row || row.processingResult !== SubscriptionEventProcessingResult.ignored) {
    return false;
  }
  const payload = row.payload as { reason?: string } | null;
  if (payload?.reason !== "subscription_row_not_found") {
    return false;
  }
  await prisma.subscriptionEvent.delete({ where: { stripeEventId } });
  logTrialSync("activation.webhook_retry_cleared", { stripeEventId, reason: payload.reason });
  return true;
}
