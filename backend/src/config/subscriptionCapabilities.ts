import type { BusinessSubscriptionTier } from "@prisma/client";

/** Product capabilities enforced server-side — single plan matrix (see entitlement resolver). */
export type SubscriptionCapability =
  | "employeeQr"
  | "locationQr"
  | "tableQr"
  | "teamManagement"
  | "customerFeedback"
  | "tipManagement"
  | "basicAnalytics"
  | "qrTemplates"
  | "physicalQrPrinting"
  | "physicalQrPrintingIncluded"
  | "brandingCustomization"
  | "advancedAnalytics"
  | "csvExport"
  | "multiLocation"
  | "employeeGoals"
  | "customJobTitles";

/** Phase B.2 — canonical feature key (1:1 with SubscriptionCapability). */
export type FeatureKey = SubscriptionCapability;

const BASIC_CAPABILITIES: SubscriptionCapability[] = [
  "tipManagement",
  "employeeQr",
  "locationQr",
  "tableQr",
  "basicAnalytics",
  "qrTemplates",
  "physicalQrPrinting",
  "teamManagement",
];

const PRO_CAPABILITIES: SubscriptionCapability[] = [
  ...BASIC_CAPABILITIES,
  "physicalQrPrintingIncluded",
  "brandingCustomization",
  "advancedAnalytics",
  "csvExport",
  "multiLocation",
  "employeeGoals",
  "customerFeedback",
  "customJobTitles",
];

const ENTERPRISE_CAPABILITIES: SubscriptionCapability[] = [...PRO_CAPABILITIES];

const TIER_CAPABILITIES: Record<BusinessSubscriptionTier, ReadonlySet<SubscriptionCapability>> = {
  basic: new Set(BASIC_CAPABILITIES),
  premium: new Set(PRO_CAPABILITIES),
  enterprise: new Set(ENTERPRISE_CAPABILITIES),
};

export type PlanResourceLimit = "locations" | "tables";

export type PlanLimits = {
  /** `null` = unlimited for the tier. */
  maxLocations: number | null;
  maxTables: number | null;
};

const PLAN_LIMITS: Record<BusinessSubscriptionTier, PlanLimits> = {
  basic: { maxLocations: 1, maxTables: 1 },
  premium: { maxLocations: null, maxTables: null },
  enterprise: { maxLocations: null, maxTables: null },
};

export const PLAN_LIMIT_EXCEEDED_CODE = "PLAN_LIMIT_EXCEEDED" as const;

export const ALL_SUBSCRIPTION_CAPABILITIES: readonly SubscriptionCapability[] = [
  ...ENTERPRISE_CAPABILITIES,
] as const;

export function capabilitiesForTier(tier: BusinessSubscriptionTier): SubscriptionCapability[] {
  return [...(TIER_CAPABILITIES[tier] ?? [])];
}

export function getPlanLimitsForTier(tier: BusinessSubscriptionTier | null | undefined): PlanLimits {
  if (!tier) return { maxLocations: 0, maxTables: 0 };
  return PLAN_LIMITS[tier] ?? { maxLocations: 0, maxTables: 0 };
}

export function getPlanLimitForResource(
  tier: BusinessSubscriptionTier | null | undefined,
  resource: PlanResourceLimit,
): number | null {
  const limits = getPlanLimitsForTier(tier);
  return resource === "locations" ? limits.maxLocations : limits.maxTables;
}

export function isWithinPlanLimit(
  tier: BusinessSubscriptionTier | null | undefined,
  resource: PlanResourceLimit,
  currentCount: number,
): boolean {
  const limit = getPlanLimitForResource(tier, resource);
  if (limit === null) return true;
  return currentCount < limit;
}

export function hasSubscriptionCapability(
  tier: BusinessSubscriptionTier | null | undefined,
  capability: SubscriptionCapability,
): boolean {
  if (!tier) return false;
  return TIER_CAPABILITIES[tier]?.has(capability) ?? false;
}

export function minimumTierForCapability(capability: SubscriptionCapability): BusinessSubscriptionTier {
  if (TIER_CAPABILITIES.basic.has(capability)) return "basic";
  if (TIER_CAPABILITIES.premium.has(capability)) return "premium";
  return "enterprise";
}

/** Basic tier: summary-only stats; premium+ may use analytics/full scopes. */
export function isStatsScopeAllowedForTier(
  tier: BusinessSubscriptionTier | null,
  scope: "summary" | "roster" | "analytics" | "full",
): boolean {
  if (scope === "summary" || scope === "roster") return true;
  if (!tier) return false;
  return hasSubscriptionCapability(tier, "advancedAnalytics");
}

/** Employee tips API scopes (account is always allowed). */
export function isEmployeeTipsScopeAllowedForTier(
  tier: BusinessSubscriptionTier | null,
  scope: "account" | "summary" | "analytics" | "full",
): boolean {
  if (scope === "account" || scope === "summary") return true;
  if (!tier) return false;
  return hasSubscriptionCapability(tier, "advancedAnalytics");
}

/** @deprecated Use getPlanLimitForResource(tier, "locations") */
export const BASIC_MAX_LOCATIONS = PLAN_LIMITS.basic.maxLocations ?? 1;

/** Manager tips reporting scopes require Premium+. Operational filters do not. */
export function businessTipsQueryRequiresAdvancedAnalytics(query: {
  scope?: string;
  employeeId?: string;
  locationId?: string;
  tableId?: string;
  range?: string;
  from?: Date | null;
  to?: Date | null;
}): boolean {
  return query.scope === "full" || query.scope === "analytics";
}

/** Employee tip history listing is operational; reporting scopes stay on analytics APIs. */
export function employeeTipsListQueryRequiresAdvancedAnalytics(_query: {
  range?: string;
  from?: Date | null;
  to?: Date | null;
}): boolean {
  return false;
}
