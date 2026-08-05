/**
 * Stats API scope selection — must match web `useBusinessDashboardStats`
 * and backend `isStatsScopeAllowedForTier`.
 *
 * Basic / Starter: `summary` only.
 * Premium+: may request `full` / `analytics`.
 *
 * Also used as the mobile proxy for Premium feature gates
 * (advancedAnalytics, customerFeedback, employeeGoals) until a
 * dedicated entitlements endpoint is wired.
 */

export type BusinessStatsScope = "summary" | "roster" | "analytics" | "full";

export type SubscriptionTierHint = "basic" | "premium" | "enterprise" | string | null | undefined;

export function isPremiumAnalyticsTier(tier: SubscriptionTierHint): boolean {
  const normalized = String(tier ?? "").trim().toLowerCase();
  return normalized === "premium" || normalized === "enterprise";
}

/** Dashboard home KPIs — always available on Basic. */
export function resolveDashboardStatsScope(
  _tier?: SubscriptionTierHint,
): Extract<BusinessStatsScope, "summary"> {
  return "summary";
}

/**
 * Analytics / performance screens — prefer full when entitled; otherwise summary
 * so the screen never hard-fails with SUBSCRIPTION_REQUIRED.
 */
export function resolveAnalyticsStatsScope(tier: SubscriptionTierHint): BusinessStatsScope {
  return isPremiumAnalyticsTier(tier) ? "full" : "summary";
}
