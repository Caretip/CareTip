import type { BillingStatus, SubscriptionPlanKey } from "./api";

/** Resolved plan key from billing DTO (internal keys unchanged). */
export function resolveBillingPlanKey(billing: BillingStatus): SubscriptionPlanKey | null {
  return billing.planKey ?? billing.subscriptionTier ?? null;
}

/** True when the venue has an operational plan (Basic counts as active). */
export function hasOperationalBillingPlan(billing: BillingStatus): boolean {
  if (billing.accessSource === "sponsored") return true;
  const planKey = resolveBillingPlanKey(billing);
  if (!planKey) return false;
  if (planKey === "basic") return true;
  return billing.status !== "none";
}

/** True while a Stripe Pro trial is currently running (not merely historically used). */
export function isBillingTrialActive(billing: BillingStatus): boolean {
  if (billing.isTrial || billing.status === "trialing") return true;
  if (billing.trialDaysRemaining != null && billing.trialDaysRemaining > 0) return true;
  if (billing.trialEndsAt) {
    const endsAt = Date.parse(billing.trialEndsAt);
    if (Number.isFinite(endsAt) && endsAt > Date.now()) return true;
  }
  return false;
}

export function isOnInternalBasicPlan(billing: BillingStatus): boolean {
  const planKey = resolveBillingPlanKey(billing);
  return planKey === "basic" && !isBillingTrialActive(billing);
}

/**
 * Context-aware “Manage Plan” CTA:
 * - Free / internal Basic → scroll to in-page pricing (caller handles scroll)
 * - Active paid Stripe subscription (Pro / Premium) → Stripe Customer Portal
 * - Active trial with Stripe customer already established → Stripe Customer Portal
 * - Sponsored / no Stripe customer → do not open portal
 */
export function shouldManagePlanOpenStripePortal(billing: BillingStatus): boolean {
  if (billing.accessSource === "sponsored") return false;
  if (!billing.billingEnabled || !billing.stripeConfigured) return false;
  if (!billing.stripeCustomerId?.trim()) return false;

  // Paid (or past-checkout) Stripe subscription linked on the mirror.
  if (billing.hasStripeBilling) return true;

  // Trial with Stripe billing already set up (customer present) even if mirror lag.
  if (isBillingTrialActive(billing)) return true;

  return false;
}

/**
 * Post-trial downgrade: Pro trial truly ended and the venue is back on Basic
 * without an upgraded paid Pro/Premium subscription.
 */
export function shouldShowTrialExpiredUpgrade(billing: BillingStatus): boolean {
  if (billing.accessSource === "sponsored") return false;
  if (isBillingTrialActive(billing)) return false;
  if (!billing.trialUsed || billing.trialEligible) return false;
  if (!isOnInternalBasicPlan(billing)) return false;
  const lastTrial = billing.lastTrialPlanKey;
  return lastTrial === "premium" || lastTrial == null;
}

/**
 * "Trial has been used" copy — only after expiry on Basic, never during an active trial
 * or while the venue still has paid Pro entitlements.
 */
export function shouldShowTrialAlreadyUsedMessage(billing: BillingStatus): boolean {
  return shouldShowTrialExpiredUpgrade(billing);
}
