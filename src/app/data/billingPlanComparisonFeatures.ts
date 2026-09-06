import type { TFunction } from "i18next";
import type { PricingTierKey } from "./pricingConfig";

const BILLING_PLAN_FEATURE_SLOTS: Record<PricingTierKey, number> = {
  starter: 5,
  business: 5,
  enterprise: 4,
};

/** Subscription-page plan comparison bullets (distinct from public marketing copy). */
export function buildBillingPlanComparisonFeatures(t: TFunction, tierKey: PricingTierKey): string[] {
  const planKey =
    tierKey === "starter" ? "basic" : tierKey === "business" ? "pro" : "premium";
  const features: string[] = [];
  const max = BILLING_PLAN_FEATURE_SLOTS[tierKey];
  for (let i = 0; i < max; i++) {
    const key = `business.billing.planComparison.${planKey}.f${i}`;
    const value = t(key);
    if (value && value !== key) features.push(value);
  }
  return features;
}
