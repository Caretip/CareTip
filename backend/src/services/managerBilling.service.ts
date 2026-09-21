import {
  SubscriptionStatus,
  type BillingCycle,
  type BusinessSubscriptionTier,
  type SubscriptionPlanKey,
} from "@prisma/client";
import { isSubscriptionBillingEnabled } from "../config/featureFlags.js";
import { getSponsoredProgrammeDefinition } from "../config/sponsoredAccess.config.js";
import { prisma } from "../prisma.js";
import {
  createBillingPortalSession,
  createPlatformSubscriptionCheckoutSession,
  scheduleStripeSubscriptionCancelAtPeriodEnd,
  type BillingPortalFlow,
  type SubscriptionCheckoutFlow,
} from "./stripeBilling.service.js";
import { assertSelfServeCheckoutPlanKey } from "../lib/subscription/billingCheckoutPolicy.js";
import { mapPlanKeyToBusinessTier } from "../lib/subscription/mapSubscriptionPlanKey.js";
import { resolveSubscriptionEntitlements } from "./subscriptionEntitlement.service.js";
import type { EntitlementAccessSource } from "../lib/subscription/subscriptionEntitlementTypes.js";
import { isStripeConfigured } from "./stripe.service.js";
import { tryActivateSubscriptionFromStripeForBusiness } from "./subscriptionActivation.service.js";
import { logTrialSync } from "../lib/subscription/trialSyncDebugLog.js";
import { resolveTrialEligibilityForBusiness } from "./trialEligibility.service.js";

export type BillingLifecycleStatus = SubscriptionStatus | "none";

export type BillingStatusDto = {
  planKey: SubscriptionPlanKey | null;
  billingCycle: BillingCycle | null;
  status: BillingLifecycleStatus;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  isTrial: boolean;
  trialDaysRemaining: number | null;
  currentPeriodEnd: string | null;
  renewalDate: string | null;
  cancelAtPeriodEnd: boolean;
  cancellationEffective: string | null;
  hasStripeBilling: boolean;
  stripeCustomerId: string | null;
  subscriptionCreatedAt: string | null;
  syncedAt: string | null;
  subscriptionTier: BusinessSubscriptionTier | null;
  billingEnabled: boolean;
  stripeConfigured: boolean;
  accessSource: EntitlementAccessSource;
  sponsoredProgrammeKey: string | null;
  sponsoredProgrammeLabelKey: string | null;
  trialEligible: boolean;
  /** Alias for trialEligible — explicit CTA signal for Pro trial from Basic. */
  canStartTrial: boolean;
  trialUsed: boolean;
  /** Active trial plan (same as planKey while trialing). */
  trialPlanKey: SubscriptionPlanKey | null;
  /** Plan from a previous trial — preselect for post-trial upgrade. */
  lastTrialPlanKey: SubscriptionPlanKey | null;
};

export type BillingTimelineEventDto = {
  id: string;
  auditType: string;
  occurredAt: string;
  processingResult: string;
  payload: Record<string, unknown> | null;
};

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function trialDaysRemaining(trialEndsAt: Date | null | undefined): number | null {
  if (!trialEndsAt) return null;
  const msPerDay = 24 * 60 * 60 * 1000;
  const days = Math.ceil((trialEndsAt.getTime() - Date.now()) / msPerDay);
  return Math.max(0, days);
}

const TIMELINE_AUDIT_TYPES = new Set([
  "subscription_created",
  "subscription_plan_changed",
  "stripe_subscription_created",
  "stripe_subscription_updated",
  "stripe_subscription_deleted",
  "invoice_payment_succeeded",
  "payment_failed",
  "checkout_session_completed",
]);

export async function getBillingStatusForBusiness(businessId: string): Promise<BillingStatusDto> {
  const row = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      stripeCustomerId: true,
      subscription: {
        select: {
          planKey: true,
          billingCycle: true,
          status: true,
          trialStartedAt: true,
          trialEndsAt: true,
          isTrial: true,
          currentPeriodEnd: true,
          renewalDate: true,
          cancelAtPeriodEnd: true,
          cancellationEffective: true,
          stripeSubscriptionId: true,
          stripeCustomerId: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });

  const entitlements = await resolveSubscriptionEntitlements(businessId);
  const trialEligibility = await resolveTrialEligibilityForBusiness(businessId);
  const billingEnabled = isSubscriptionBillingEnabled();
  const stripeConfigured = isStripeConfigured();
  const sponsoredDef =
    entitlements.accessSource === "sponsored" && entitlements.sponsoredProgrammeKey
      ? getSponsoredProgrammeDefinition(entitlements.sponsoredProgrammeKey)
      : null;
  const sponsoredFields = {
    accessSource: entitlements.accessSource,
    sponsoredProgrammeKey: entitlements.sponsoredProgrammeKey,
    sponsoredProgrammeLabelKey: sponsoredDef?.labelKey ?? null,
  };

  if (!row?.subscription) {
    return {
      planKey: null,
      billingCycle: null,
      status: "none",
      trialStartedAt: null,
      trialEndsAt: null,
      isTrial: false,
      trialDaysRemaining: null,
      currentPeriodEnd: null,
      renewalDate: null,
      cancelAtPeriodEnd: false,
      cancellationEffective: null,
      hasStripeBilling: false,
      stripeCustomerId: row?.stripeCustomerId ?? null,
      subscriptionCreatedAt: null,
      syncedAt: null,
      subscriptionTier: entitlements.subscriptionTier,
      billingEnabled,
      stripeConfigured,
      trialEligible: trialEligibility.eligible,
      canStartTrial: trialEligibility.eligible,
      trialUsed: trialEligibility.trialUsed,
      trialPlanKey: null,
      lastTrialPlanKey: trialEligibility.lastTrialPlanKey,
      ...sponsoredFields,
    };
  }

  const sub = row.subscription;
  const trialFields = {
    trialEligible: trialEligibility.eligible,
    canStartTrial: trialEligibility.eligible,
    trialUsed: trialEligibility.trialUsed,
    trialPlanKey:
      sub.isTrial || sub.status === SubscriptionStatus.trialing ? sub.planKey : null,
    lastTrialPlanKey: trialEligibility.lastTrialPlanKey,
  };

  return {
    planKey: entitlements.plan,
    billingCycle: sub.billingCycle,
    status: entitlements.hasActiveEntitlements ? sub.status : "none",
    trialStartedAt: iso(sub.trialStartedAt),
    trialEndsAt: iso(sub.trialEndsAt),
    isTrial: sub.isTrial || sub.status === SubscriptionStatus.trialing,
    trialDaysRemaining:
      sub.status === SubscriptionStatus.trialing || sub.isTrial
        ? trialDaysRemaining(sub.trialEndsAt)
        : null,
    currentPeriodEnd: iso(sub.currentPeriodEnd),
    renewalDate: iso(sub.renewalDate),
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    cancellationEffective: iso(sub.cancellationEffective),
    hasStripeBilling: Boolean(sub.stripeSubscriptionId),
    stripeCustomerId: sub.stripeCustomerId ?? row.stripeCustomerId,
    subscriptionCreatedAt: sub.createdAt.toISOString(),
    syncedAt: sub.updatedAt.toISOString(),
    subscriptionTier: entitlements.subscriptionTier,
    billingEnabled,
    stripeConfigured,
    ...trialFields,
    ...sponsoredFields,
  };
}

export async function getBillingTimelineForBusiness(
  businessId: string,
  limit = 25,
): Promise<BillingTimelineEventDto[]> {
  const subscription = await prisma.subscription.findUnique({
    where: { businessId },
    select: { id: true },
  });
  if (!subscription) return [];

  const events = await prisma.subscriptionEvent.findMany({
    where: {
      subscriptionId: subscription.id,
      auditType: { in: [...TIMELINE_AUDIT_TYPES] },
    },
    orderBy: { occurredAt: "desc" },
    take: limit,
    select: {
      id: true,
      auditType: true,
      occurredAt: true,
      processingResult: true,
      payload: true,
    },
  });

  return events.map((e) => ({
    id: e.id,
    auditType: e.auditType,
    occurredAt: e.occurredAt.toISOString(),
    processingResult: e.processingResult,
    payload:
      e.payload && typeof e.payload === "object" && !Array.isArray(e.payload)
        ? (e.payload as Record<string, unknown>)
        : null,
  }));
}

export type CheckoutSyncStatusDto = {
  synced: boolean;
  status: SubscriptionStatus | "none" | null;
  planKey: SubscriptionPlanKey | null;
  subscriptionTier: BusinessSubscriptionTier | null;
  isTrial: boolean;
  hasStripeBilling: boolean;
};

export async function getCheckoutSyncStatusForBusiness(
  businessId: string,
  expectedPlanKey?: SubscriptionPlanKey,
  opts?: { checkoutSessionId?: string | null },
): Promise<CheckoutSyncStatusDto> {
  let dto = await getBillingStatusForBusiness(businessId);

  const checkoutSessionId = opts?.checkoutSessionId?.trim() || null;
  const shouldAttemptCheckoutReturnSync =
    dto.stripeConfigured &&
    dto.billingEnabled &&
    (dto.status === "none" || (checkoutSessionId && !dto.hasStripeBilling));

  if (shouldAttemptCheckoutReturnSync) {
    const activation = await tryActivateSubscriptionFromStripeForBusiness({
      businessId,
      checkoutSessionId,
      expectedPlanKey: expectedPlanKey,
      source: "checkout_return_sync",
    });
    logTrialSync("activation.checkout_return_sync", {
      businessId,
      checkoutSessionId,
      outcome: activation,
      expectedPlanKey: expectedPlanKey ?? null,
    });
    if (activation === "mirror_created" || activation === "mirror_updated") {
      dto = await getBillingStatusForBusiness(businessId);
    }
  }

  if (dto.status === "none") {
    return {
      synced: false,
      status: "none",
      planKey: null,
      subscriptionTier: null,
      isTrial: false,
      hasStripeBilling: false,
    };
  }

  const statusOk =
    dto.status === SubscriptionStatus.trialing || dto.status === SubscriptionStatus.active;
  const linked = dto.hasStripeBilling;
  const planOk = expectedPlanKey ? dto.planKey === expectedPlanKey : true;
  const tierOk = expectedPlanKey
    ? dto.subscriptionTier === mapPlanKeyToBusinessTier(expectedPlanKey)
    : true;

  return {
    synced: statusOk && linked && planOk && tierOk,
    status: dto.status,
    planKey: dto.planKey,
    subscriptionTier: dto.subscriptionTier,
    isTrial: dto.isTrial,
    hasStripeBilling: linked,
  };
}

export async function createManagerCheckoutSession(params: {
  businessId: string;
  managerEmail: string;
  businessName: string;
  planKey: SubscriptionPlanKey;
  billingCycle?: "monthly" | "yearly";
  includeTrial?: boolean;
  checkoutFlow?: SubscriptionCheckoutFlow;
}): Promise<{ sessionId: string; url: string | null }> {
  const entitlements = await resolveSubscriptionEntitlements(params.businessId);
  if (entitlements.accessSource === "sponsored") {
    throw new Error("Checkout is not available while sponsored access is active");
  }

  assertSelfServeCheckoutPlanKey(params.planKey);

  const subscription = await prisma.subscription.findUnique({
    where: { businessId: params.businessId },
    select: { id: true },
  });

  return createPlatformSubscriptionCheckoutSession({
    businessId: params.businessId,
    subscriptionId: subscription?.id ?? null,
    managerEmail: params.managerEmail,
    businessName: params.businessName,
    planKey: params.planKey,
    billingCycle: params.billingCycle,
    includeTrial: params.includeTrial,
    checkoutFlow: params.checkoutFlow,
  });
}

export async function createManagerPortalSession(params: {
  stripeCustomerId: string;
  flow?: BillingPortalFlow;
  returnUrl?: string;
}): Promise<{ url: string }> {
  return createBillingPortalSession({
    stripeCustomerId: params.stripeCustomerId,
    flow: params.flow,
    returnUrl: params.returnUrl,
  });
}

export async function scheduleManagerCancelAtPeriodEnd(params: {
  businessId: string;
}): Promise<{
  cancelAtPeriodEnd: boolean;
  cancellationEffective: string | null;
}> {
  const subscription = await prisma.subscription.findUnique({
    where: { businessId: params.businessId },
    select: { stripeSubscriptionId: true },
  });
  if (!subscription?.stripeSubscriptionId) {
    throw new Error("No active Stripe subscription to cancel");
  }

  const updated = await scheduleStripeSubscriptionCancelAtPeriodEnd(subscription.stripeSubscriptionId);
  const effective =
    updated.cancel_at_period_end && updated.current_period_end
      ? new Date(updated.current_period_end * 1000).toISOString()
      : null;

  return {
    cancelAtPeriodEnd: updated.cancel_at_period_end === true,
    cancellationEffective: effective,
  };
}
