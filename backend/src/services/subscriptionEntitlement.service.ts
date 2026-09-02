import { BusinessSubscriptionTier, Role, SubscriptionStatus, type SubscriptionPlanKey } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import {
  type PlanResourceLimit,
  PLAN_LIMIT_EXCEEDED_CODE,
  type SubscriptionCapability,
  capabilitiesForTier,
  getPlanLimitForResource,
  getPlanLimitsForTier,
  hasSubscriptionCapability,
  isWithinPlanLimit,
  minimumTierForCapability,
} from "../config/subscriptionCapabilities.js";
import { mapPlanKeyToBusinessTier } from "../lib/subscription/mapSubscriptionPlanKey.js";
import { isSubscriptionMirrorEntitled } from "../lib/subscription/subscriptionMirrorEntitlement.js";
import {
  EMPTY_SUBSCRIPTION_ENTITLEMENTS,
  type SubscriptionEntitlementState,
  type SubscriptionLifecycleStatus,
} from "../lib/subscription/subscriptionEntitlementTypes.js";
import { resolveSponsoredCapabilityProfile } from "../config/sponsoredAccess.config.js";
import { findActiveSponsoredGrantForBusiness } from "./sponsoredAccess.service.js";
import { prisma } from "../prisma.js";

export type { SubscriptionEntitlementState, SubscriptionLifecycleStatus } from "../lib/subscription/subscriptionEntitlementTypes.js";
export { EMPTY_SUBSCRIPTION_ENTITLEMENTS } from "../lib/subscription/subscriptionEntitlementTypes.js";
export { EntitlementDeniedError, isEntitlementDeniedError } from "../lib/subscription/entitlementHttpError.js";

export const SUBSCRIPTION_REQUIRED_CODE = "SUBSCRIPTION_REQUIRED" as const;
export const PLAN_CAPABILITY_REQUIRED_CODE = "PLAN_CAPABILITY_REQUIRED" as const;
export { PLAN_LIMIT_EXCEEDED_CODE };

export type FeatureKey = SubscriptionCapability;

const ACTIVE_SUBSCRIPTION_REQUIRED_MESSAGE =
  "An active subscription is required to use this feature.";
const PRO_CAPABILITY_REQUIRED_MESSAGE = "This feature is available on Pro.";

function capabilitiesForPlan(plan: SubscriptionPlanKey): SubscriptionCapability[] {
  const tier = mapPlanKeyToBusinessTier(plan);
  return capabilitiesForTier(tier);
}

function isMirrorRowEntitled(sub: {
  status: SubscriptionStatus;
  cancelAtPeriodEnd: boolean;
  cancellationEffective: Date | null;
  currentPeriodEnd: Date | null;
  canceledAt: Date | null;
}): boolean {
  return isSubscriptionMirrorEntitled(sub);
}

function buildEntitledState(
  status: SubscriptionLifecycleStatus,
  plan: SubscriptionPlanKey,
): SubscriptionEntitlementState {
  const subscriptionTier = mapPlanKeyToBusinessTier(plan);
  return {
    status,
    plan,
    capabilities: capabilitiesForPlan(plan),
    limits: getPlanLimitsForTier(subscriptionTier),
    subscriptionTier,
    hasActiveEntitlements: true,
    accessSource: "subscription",
    sponsoredProgrammeKey: null,
  };
}

function buildSponsoredState(
  programmeKey: string,
  capabilityProfileKey?: string | null,
): SubscriptionEntitlementState | null {
  const profile = resolveSponsoredCapabilityProfile(programmeKey, capabilityProfileKey);
  if (!profile) return null;
  return {
    status: "none",
    plan: null,
    capabilities: profile.capabilities,
    limits: profile.limits,
    subscriptionTier: profile.subscriptionTier,
    hasActiveEntitlements: true,
    accessSource: "sponsored",
    sponsoredProgrammeKey: programmeKey,
  };
}

/**
 * Authoritative subscription + entitlement resolver.
 * Never infers a plan from missing data or Business.subscriptionTier alone.
 *
 * Internal Basic (`planKey=basic`, `status=active`, no Stripe IDs) is a first-class
 * entitled subscription — `hasActiveEntitlements: true`, `accessSource: "subscription"`.
 * `accessSource: "none"` is exceptional (no mirror row, ended mirror without downgrade, or no sponsor).
 */
export async function resolveSubscriptionEntitlements(
  businessId: string,
): Promise<SubscriptionEntitlementState> {
  const row = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      subscription: {
        select: {
          planKey: true,
          status: true,
          cancelAtPeriodEnd: true,
          cancellationEffective: true,
          currentPeriodEnd: true,
          canceledAt: true,
        },
      },
    },
  });

  if (!row?.subscription) {
    const sponsoredGrant = await findActiveSponsoredGrantForBusiness(businessId);
    if (sponsoredGrant) {
      const sponsored = buildSponsoredState(
        sponsoredGrant.programmeKey,
        sponsoredGrant.capabilityProfileKey,
      );
      if (sponsored) return sponsored;
    }
    return EMPTY_SUBSCRIPTION_ENTITLEMENTS;
  }

  const sub = row.subscription;
  if (!isMirrorRowEntitled(sub)) {
    const sponsoredGrant = await findActiveSponsoredGrantForBusiness(businessId);
    if (sponsoredGrant) {
      const sponsored = buildSponsoredState(
        sponsoredGrant.programmeKey,
        sponsoredGrant.capabilityProfileKey,
      );
      if (sponsored) return sponsored;
    }
    return EMPTY_SUBSCRIPTION_ENTITLEMENTS;
  }

  return buildEntitledState(sub.status, sub.planKey);
}

/** @deprecated Use resolveSubscriptionEntitlements — returns null when no entitled subscription. */
export async function getSubscriptionTierForBusinessId(
  businessId: string,
): Promise<BusinessSubscriptionTier | null> {
  const state = await resolveSubscriptionEntitlements(businessId);
  return state.subscriptionTier;
}

export async function getSubscriptionTierForManagerUserId(
  userId: string,
): Promise<BusinessSubscriptionTier | null> {
  const row = await prisma.business.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!row) return null;
  const state = await resolveSubscriptionEntitlements(row.id);
  return state.subscriptionTier;
}

export async function getSubscriptionTierForEmployeeUserId(
  userId: string,
): Promise<BusinessSubscriptionTier | null> {
  const employee = await prisma.employee.findFirst({
    where: { userId },
    select: { businessId: true },
  });
  if (!employee) return null;
  const state = await resolveSubscriptionEntitlements(employee.businessId);
  return state.subscriptionTier;
}

export function subscriptionBypass(req: Request): boolean {
  if (req.user?.impersonatedBy) return true;
  if (req.user?.role === Role.SUPER_ADMIN) return true;
  return false;
}

export function hasFeatureForTier(
  tier: BusinessSubscriptionTier | null,
  featureKey: FeatureKey,
): boolean {
  if (!tier) return false;
  return hasSubscriptionCapability(tier, featureKey);
}

export function hasFeatureForEntitlements(
  state: SubscriptionEntitlementState,
  featureKey: FeatureKey,
): boolean {
  if (!state.hasActiveEntitlements) return false;
  return state.capabilities.includes(featureKey);
}

export async function hasFeature(businessId: string, featureKey: FeatureKey): Promise<boolean> {
  const state = await resolveSubscriptionEntitlements(businessId);
  return hasFeatureForEntitlements(state, featureKey);
}

export async function resolveBusinessIdForRequest(req: Request): Promise<string | null> {
  const uid = req.user?.userId ?? req.user?.id;
  if (!uid) return null;
  if (req.user?.role === Role.MANAGER) {
    const row = await prisma.business.findUnique({
      where: { userId: uid },
      select: { id: true },
    });
    return row?.id ?? null;
  }
  if (req.user?.role === Role.EMPLOYEE) {
    const row = await prisma.employee.findFirst({
      where: { userId: uid },
      select: { businessId: true },
    });
    return row?.businessId ?? null;
  }
  return null;
}

export async function hasFeatureForRequest(req: Request, featureKey: FeatureKey): Promise<boolean> {
  if (subscriptionBypass(req)) return true;
  const businessId = await resolveBusinessIdForRequest(req);
  if (!businessId) return false;
  return hasFeature(businessId, featureKey);
}

export function businessHasCapability(
  tier: BusinessSubscriptionTier,
  capability: SubscriptionCapability,
): boolean {
  return hasSubscriptionCapability(tier, capability);
}

export function subscriptionRequiredPayload(capability: SubscriptionCapability | FeatureKey) {
  return {
    success: false as const,
    code: SUBSCRIPTION_REQUIRED_CODE,
    capability,
    requiredTier: minimumTierForCapability(capability),
    message: ACTIVE_SUBSCRIPTION_REQUIRED_MESSAGE,
  };
}

/** Entitled plan that does not include this capability (not "no subscription"). */
export function planCapabilityRequiredPayload(capability: SubscriptionCapability | FeatureKey) {
  return {
    success: false as const,
    code: PLAN_CAPABILITY_REQUIRED_CODE,
    capability,
    requiredTier: minimumTierForCapability(capability),
    message: PRO_CAPABILITY_REQUIRED_MESSAGE,
  };
}

export function featureAccessDeniedPayload(
  state: SubscriptionEntitlementState,
  featureKey: FeatureKey,
) {
  if (!state.hasActiveEntitlements) {
    return subscriptionRequiredPayload(featureKey);
  }
  return planCapabilityRequiredPayload(featureKey);
}

export async function featureAccessDeniedPayloadForBusiness(
  businessId: string,
  featureKey: FeatureKey,
) {
  const state = await resolveSubscriptionEntitlements(businessId);
  return featureAccessDeniedPayload(state, featureKey);
}

export function planLimitExceededPayload(
  resource: PlanResourceLimit,
  tier: BusinessSubscriptionTier | null,
) {
  const limit = getPlanLimitForResource(tier, resource);
  return {
    success: false as const,
    code: PLAN_LIMIT_EXCEEDED_CODE,
    resource,
    limit,
    requiredTier: "premium" as const,
    message:
      resource === "locations"
        ? "Your plan supports one location. Upgrade to Business for multi-location support."
        : "Your plan supports one table. Upgrade to Business for multiple tables.",
  };
}

export async function assertPlanLimitForBusiness(
  businessId: string,
  resource: PlanResourceLimit,
  currentCount: number,
): Promise<
  | { ok: true }
  | { ok: false; reason: "no_entitlement" | "quota"; tier: BusinessSubscriptionTier | null }
> {
  const state = await resolveSubscriptionEntitlements(businessId);
  if (!state.hasActiveEntitlements) {
    return { ok: false, reason: "no_entitlement", tier: null };
  }
  if (isWithinPlanLimit(state.subscriptionTier, resource, currentCount)) {
    return { ok: true };
  }
  return { ok: false, reason: "quota", tier: state.subscriptionTier };
}

export function maskEmployeeGoalsInResponse<T extends Record<string, unknown>>(
  body: T,
  includeGoals: boolean,
): T {
  if (includeGoals) return body;
  return {
    ...body,
    goal: null,
    monthlyGoal: null,
  };
}

/** Any entitled subscription (Basic+). Operational APIs use this before capability checks. */
export function requireOperationalSubscription() {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (subscriptionBypass(req)) {
      return next();
    }
    const uid = req.user?.userId ?? req.user?.id;
    if (!uid) {
      return res.status(401).json({ message: "Authentication required" });
    }
    const businessId = await resolveBusinessIdForRequest(req);
    if (!businessId) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }
    const state = await resolveSubscriptionEntitlements(businessId);
    if (!state.hasActiveEntitlements) {
      return res.status(403).json(subscriptionRequiredPayload("tipManagement"));
    }
    return next();
  };
}

export function requireFeature(featureKey: FeatureKey) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (subscriptionBypass(req)) {
      return next();
    }
    const uid = req.user?.userId ?? req.user?.id;
    if (!uid) {
      return res.status(401).json({ message: "Authentication required" });
    }
    const businessId = await resolveBusinessIdForRequest(req);
    if (!businessId) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }
    const state = await resolveSubscriptionEntitlements(businessId);
    if (hasFeatureForEntitlements(state, featureKey)) {
      return next();
    }
    return res.status(403).json(featureAccessDeniedPayload(state, featureKey));
  };
}

export async function enforceFeatureForRequest(
  req: Request,
  res: Response,
  featureKey: FeatureKey,
): Promise<boolean> {
  if (subscriptionBypass(req)) return true;
  const businessId = await resolveBusinessIdForRequest(req);
  if (!businessId) {
    res.status(403).json({ message: "Insufficient permissions" });
    return false;
  }
  const state = await resolveSubscriptionEntitlements(businessId);
  if (hasFeatureForEntitlements(state, featureKey)) return true;
  res.status(403).json(featureAccessDeniedPayload(state, featureKey));
  return false;
}
