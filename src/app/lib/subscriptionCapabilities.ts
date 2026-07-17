/** Mirrors backend `subscriptionCapabilities.ts` for UI gating (server remains source of truth). */

export type BusinessSubscriptionTier = "basic" | "premium" | "enterprise";

export type SubscriptionLifecycleStatus =
  | "none"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "incomplete";

export type SubscriptionCapability =
  | "employeeQr"
  | "locationQr"
  | "tableQr"
  | "teamManagement"
  | "customerFeedback"
  | "tipManagement"
  | "basicAnalytics"
  | "qrTemplates"
  | "brandingCustomization"
  | "advancedAnalytics"
  | "csvExport"
  | "multiLocation"
  | "employeeGoals"
  | "customJobTitles";

/** Enterprise-only capabilities (placeholders — enforced when product ships). */
export type EnterpriseFeatureKey =
  | "apiAccess"
  | "multiBrand"
  | "customReporting"
  | "dedicatedOnboarding"
  | "accountManager";

export type FeatureKey = SubscriptionCapability | EnterpriseFeatureKey;

export type PlanResourceLimit = "locations" | "tables";

export type PlanLimits = {
  maxLocations: number | null;
  maxTables: number | null;
};

const BASIC_CAPABILITIES: SubscriptionCapability[] = [
  "tipManagement",
  "employeeQr",
  "locationQr",
  "tableQr",
  "basicAnalytics",
  "qrTemplates",
  "teamManagement",
];

const PRO_CAPABILITIES: SubscriptionCapability[] = [
  ...BASIC_CAPABILITIES,
  "brandingCustomization",
  "advancedAnalytics",
  "csvExport",
  "multiLocation",
  "employeeGoals",
  "customerFeedback",
  "customJobTitles",
];

const ENTERPRISE_FEATURES: EnterpriseFeatureKey[] = [
  "apiAccess",
  "multiBrand",
  "customReporting",
  "dedicatedOnboarding",
  "accountManager",
];

const TIER_CAPABILITIES: Record<BusinessSubscriptionTier, ReadonlySet<SubscriptionCapability>> = {
  basic: new Set(BASIC_CAPABILITIES),
  premium: new Set(PRO_CAPABILITIES),
  enterprise: new Set(PRO_CAPABILITIES),
};

const PLAN_LIMITS: Record<BusinessSubscriptionTier, PlanLimits> = {
  basic: { maxLocations: 1, maxTables: 1 },
  premium: { maxLocations: null, maxTables: null },
  enterprise: { maxLocations: null, maxTables: null },
};

/** Returns null when the business has no entitled subscription — never infer Starter. */
export function resolveSubscriptionTier(
  tier: BusinessSubscriptionTier | undefined | null,
): BusinessSubscriptionTier | null {
  if (tier === "basic" || tier === "premium" || tier === "enterprise") return tier;
  return null;
}

export function isEnterpriseFeatureKey(key: FeatureKey): key is EnterpriseFeatureKey {
  return (ENTERPRISE_FEATURES as readonly string[]).includes(key);
}

export function getPlanLimitsForTier(tier: BusinessSubscriptionTier | undefined | null): PlanLimits {
  const resolved = resolveSubscriptionTier(tier);
  if (!resolved) return { maxLocations: 0, maxTables: 0 };
  return PLAN_LIMITS[resolved] ?? { maxLocations: 0, maxTables: 0 };
}

export function isWithinPlanLimit(
  tier: BusinessSubscriptionTier | undefined | null,
  resource: PlanResourceLimit,
  currentCount: number,
): boolean {
  const limits = getPlanLimitsForTier(tier);
  const limit = resource === "locations" ? limits.maxLocations : limits.maxTables;
  if (limit === null) return true;
  return currentCount < limit;
}

export function hasSubscriptionCapability(
  tier: BusinessSubscriptionTier | undefined | null,
  capability: SubscriptionCapability,
  resolvedCapabilities?: readonly SubscriptionCapability[] | null,
): boolean {
  if (resolvedCapabilities && resolvedCapabilities.length > 0) {
    return resolvedCapabilities.includes(capability);
  }
  const resolved = resolveSubscriptionTier(tier);
  if (!resolved) return false;
  return TIER_CAPABILITIES[resolved]?.has(capability) ?? false;
}

export function hasFeature(
  tier: BusinessSubscriptionTier | undefined | null,
  featureKey: FeatureKey,
  resolvedCapabilities?: readonly SubscriptionCapability[] | null,
): boolean {
  const resolved = resolveSubscriptionTier(tier);
  if (!resolved) return false;
  if (isEnterpriseFeatureKey(featureKey)) {
    return resolved === "enterprise";
  }
  return hasSubscriptionCapability(resolved, featureKey, resolvedCapabilities);
}

export function minimumTierForFeature(featureKey: FeatureKey): BusinessSubscriptionTier {
  if (isEnterpriseFeatureKey(featureKey)) return "enterprise";
  if (TIER_CAPABILITIES.basic.has(featureKey as SubscriptionCapability)) return "basic";
  return "premium";
}

export function capabilitiesForTier(
  tier: BusinessSubscriptionTier | undefined | null,
): SubscriptionCapability[] {
  const resolved = resolveSubscriptionTier(tier);
  if (!resolved) return [];
  return [...(TIER_CAPABILITIES[resolved] ?? [])];
}

