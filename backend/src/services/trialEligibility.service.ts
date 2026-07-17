import { SubscriptionPlanKey, SubscriptionStatus } from "@prisma/client";
import { isSubscriptionBillingEnabled } from "../config/featureFlags.js";
import { isSubscriptionTrialEnabled } from "../config/subscriptionTrial.js";
import { isSubscriptionMirrorEntitled } from "../lib/subscription/subscriptionMirrorEntitlement.js";
import { prisma } from "../prisma.js";
import { isInternalBasicSubscription } from "./subscription.service.js";
import { findActiveSponsoredGrantForBusiness } from "./sponsoredAccess.service.js";
import { isStripeConfigured } from "./stripe.service.js";

export type TrialEligibilityReason =
  | "eligible"
  | "sponsored"
  | "active_pro"
  | "trialing_pro"
  | "premium"
  | "trial_used"
  | "not_internal_basic"
  | "billing_unavailable"
  /** @deprecated Use active_pro — kept for log compatibility */
  | "active_subscription";

export type TrialEligibility = {
  eligible: boolean;
  trialUsed: boolean;
  reason: TrialEligibilityReason;
  /** Plan evaluated during the last trial — used to preselect post-trial upgrade. */
  lastTrialPlanKey: SubscriptionPlanKey | null;
};

/** Pro-only trials (internal planKey `premium` = marketing Pro). */
export function isTrialPlanKeyEligibleForStripeTrial(planKey: SubscriptionPlanKey): boolean {
  return planKey === "premium";
}

export function hasProTrialBeenConsumed(sub: {
  trialStartedAt: Date | null;
  trialExpiredAt: Date | null;
} | null): boolean {
  return Boolean(sub?.trialStartedAt ?? sub?.trialExpiredAt);
}

/** Resolve which plan the business last trialed — survives downgrade to internal Basic. */
export function resolveLastTrialPlanKey(
  sub: {
    planKey: SubscriptionPlanKey;
    status: SubscriptionStatus;
    trialStartedAt: Date | null;
    trialExpiredAt: Date | null;
  } | null,
): SubscriptionPlanKey | null {
  if (!sub) return null;
  if (sub.status === SubscriptionStatus.trialing) return sub.planKey;
  if (!hasProTrialBeenConsumed(sub)) return null;
  // Commit 2+: trials are Pro-only; after downgrade mirror is basic but history remains.
  return SubscriptionPlanKey.premium;
}

export async function resolveTrialEligibilityForBusiness(
  businessId: string,
): Promise<TrialEligibility> {
  const sponsoredGrant = await findActiveSponsoredGrantForBusiness(businessId);

  if (sponsoredGrant) {
    return {
      eligible: false,
      trialUsed: false,
      reason: "sponsored",
      lastTrialPlanKey: null,
    };
  }

  if (!isSubscriptionBillingEnabled() || !isStripeConfigured() || !isSubscriptionTrialEnabled()) {
    return {
      eligible: false,
      trialUsed: false,
      reason: "billing_unavailable",
      lastTrialPlanKey: null,
    };
  }

  const sub = await prisma.subscription.findUnique({
    where: { businessId },
    select: {
      planKey: true,
      status: true,
      stripeSubscriptionId: true,
      isTrial: true,
      cancelAtPeriodEnd: true,
      cancellationEffective: true,
      currentPeriodEnd: true,
      canceledAt: true,
      trialStartedAt: true,
      trialExpiredAt: true,
      trialEndsAt: true,
    },
  });

  const lastTrialPlanKey = resolveLastTrialPlanKey(sub);
  const trialUsed = hasProTrialBeenConsumed(sub);

  if (!sub) {
    return {
      eligible: false,
      trialUsed: false,
      reason: "not_internal_basic",
      lastTrialPlanKey: null,
    };
  }

  const entitled = isSubscriptionMirrorEntitled(sub);

  if (entitled) {
    if (sub.status === SubscriptionStatus.trialing || sub.isTrial) {
      // Trial is in progress — do not mark as "used" for UI (history still blocks repeats via checkout).
      return {
        eligible: false,
        trialUsed: false,
        reason: "trialing_pro",
        lastTrialPlanKey: sub.planKey,
      };
    }

    if (sub.planKey === SubscriptionPlanKey.enterprise) {
      return {
        eligible: false,
        // Paid Premium: trial history may exist, but "used" messaging is for Basic post-expiry only.
        trialUsed: false,
        reason: "premium",
        lastTrialPlanKey,
      };
    }

    if (!isInternalBasicSubscription(sub)) {
      return {
        eligible: false,
        // Paid Pro after conversion: suppress "trial used" upgrade nag; checkout still blocked by eligible=false.
        trialUsed: false,
        reason: sub.planKey === SubscriptionPlanKey.premium ? "active_pro" : "premium",
        lastTrialPlanKey,
      };
    }
  }

  if (trialUsed) {
    return {
      eligible: false,
      trialUsed: true,
      reason: "trial_used",
      lastTrialPlanKey,
    };
  }

  if (!isInternalBasicSubscription(sub)) {
    return {
      eligible: false,
      trialUsed,
      reason: "not_internal_basic",
      lastTrialPlanKey,
    };
  }

  return {
    eligible: true,
    trialUsed: false,
    reason: "eligible",
    lastTrialPlanKey: null,
  };
}

export async function assertTrialCheckoutAllowed(
  businessId: string,
  planKey: SubscriptionPlanKey,
): Promise<void> {
  if (!isTrialPlanKeyEligibleForStripeTrial(planKey)) {
    throw new Error("Free trial is only available for Pro");
  }

  const eligibility = await resolveTrialEligibilityForBusiness(businessId);
  if (!eligibility.eligible) {
    throw new Error(
      eligibility.reason === "trial_used"
        ? "Free trial has already been used for this business"
        : "Free trial is not available",
    );
  }
}
