import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchBusinessProfile, getEmployeeProfile } from "../lib/api";

import { BILLING_CHECKOUT_SYNCED_EVENT } from "../lib/billingCheckoutSuccessSync";

import {

  capabilitiesForTier,

  getPlanLimitsForTier,

  hasFeature as hasFeatureForTier,

  hasSubscriptionCapability,

  resolveSubscriptionTier,

  type BusinessSubscriptionTier,

  type FeatureKey,

  type PlanLimits,

  type SubscriptionCapability,

  type SubscriptionLifecycleStatus,

} from "@/app/lib/subscriptionCapabilities";

import {

  getSubscriptionStatusFromSession,

  getSubscriptionTierFromSession,

  getAccessSourceFromSession,

  primeSubscriptionEntitlementsFromSession,

  type EntitlementAccessSource,

} from "../lib/subscriptionSessionCache";

import { isEntitlementsSessionPrimed } from "../lib/subscriptionEntitlementFastPath";



type Role = "business" | "employee";



export function useSubscriptionEntitlements(opts: {

  enabled: boolean;

  role: Role | null | undefined;

  /** Skip network — use session cache only (mobile drawer). Ready only when cache is primed. */

  cacheOnly?: boolean;

}) {

  const sessionTier = getSubscriptionTierFromSession();

  const sessionStatus = getSubscriptionStatusFromSession();

  const sessionAccessSource = getAccessSourceFromSession();

  const [tier, setTier] = useState<BusinessSubscriptionTier | null>(() =>

    resolveSubscriptionTier(sessionTier ?? undefined),

  );

  const [status, setStatus] = useState<SubscriptionLifecycleStatus>(

    () => sessionStatus ?? (sessionTier ? "active" : "none"),

  );

  const [capabilities, setCapabilities] = useState<SubscriptionCapability[]>(() =>

    capabilitiesForTier(resolveSubscriptionTier(sessionTier ?? undefined)),

  );

  const [limits, setLimits] = useState<PlanLimits>(() =>

    getPlanLimitsForTier(resolveSubscriptionTier(sessionTier ?? undefined)),

  );

  const [accessSource, setAccessSource] = useState<EntitlementAccessSource>(
    () => sessionAccessSource ?? (sessionTier ? "subscription" : "none"),
  );

  const [ready, setReady] = useState(() => {
    if (!opts.enabled || !opts.role) return false;
    if (opts.cacheOnly) return isEntitlementsSessionPrimed();
    return isEntitlementsSessionPrimed();
  });



  const hasActiveEntitlements =
    accessSource !== "none" && tier != null;

  const isSponsored = accessSource === "sponsored";



  const loadEntitlements = useCallback(async () => {

    if (!opts.enabled || !opts.role || opts.cacheOnly) return;

    try {

      if (opts.role === "business") {

        const profile = await fetchBusinessProfile({ silent: true });

        const nextTier = resolveSubscriptionTier(profile.subscriptionTier);

        const nextAccessSource = profile.accessSource ?? (profile.hasActiveSubscription ? "subscription" : "none");

        const nextStatus = profile.subscriptionStatus ?? (nextAccessSource !== "none" ? "active" : "none");

        const nextCapabilities =

          profile.capabilities && profile.capabilities.length > 0

            ? profile.capabilities

            : capabilitiesForTier(nextTier);

        const nextLimits = profile.limits ?? getPlanLimitsForTier(nextTier);

        primeSubscriptionEntitlementsFromSession({ tier: nextTier, status: nextStatus, accessSource: nextAccessSource });

        setTier(nextTier);

        setStatus(nextStatus);

        setAccessSource(nextAccessSource);

        setCapabilities(nextCapabilities);

        setLimits(nextLimits);

      } else {

        const profile = await getEmployeeProfile({ silent: true });

        const nextTier = resolveSubscriptionTier(profile.subscriptionTier);

        const nextAccessSource =
          profile.accessSource ?? (profile.hasActiveSubscription ? "subscription" : "none");

        const nextStatus = profile.subscriptionStatus ?? (nextAccessSource !== "none" ? "active" : "none");

        primeSubscriptionEntitlementsFromSession({ tier: nextTier, status: nextStatus, accessSource: nextAccessSource });

        setTier(nextTier);

        setStatus(nextStatus);

        setAccessSource(nextAccessSource);

        setCapabilities(capabilitiesForTier(nextTier));

        setLimits(getPlanLimitsForTier(nextTier));

      }

    } catch {

      const fallbackTier = resolveSubscriptionTier(getSubscriptionTierFromSession() ?? undefined);

      const fallbackAccessSource = getAccessSourceFromSession() ?? (fallbackTier ? "subscription" : "none");

      const fallbackStatus =

        getSubscriptionStatusFromSession() ?? (fallbackAccessSource !== "none" ? "active" : "none");

      setTier(fallbackTier);

      setStatus(fallbackStatus);

      setAccessSource(fallbackAccessSource);

      setCapabilities(capabilitiesForTier(fallbackTier));

      setLimits(getPlanLimitsForTier(fallbackTier));

    } finally {

      setReady(true);

    }

  }, [opts.cacheOnly, opts.enabled, opts.role]);



  useEffect(() => {

    if (opts.cacheOnly) {

      const cachedTier = getSubscriptionTierFromSession();

      const cachedStatus = getSubscriptionStatusFromSession();

      const cachedAccessSource = getAccessSourceFromSession();

      if (cachedStatus || cachedAccessSource) {

        setStatus(cachedStatus ?? (cachedAccessSource !== "none" ? "active" : "none"));

        const resolved = resolveSubscriptionTier(cachedTier ?? undefined);

        setTier(resolved);

        setAccessSource(cachedAccessSource ?? (resolved ? "subscription" : "none"));

        setCapabilities(capabilitiesForTier(resolved));

        setLimits(getPlanLimitsForTier(resolved));

        setReady(true);

      }

      return;

    }

    if (!opts.enabled || !opts.role) {

      setReady(false);

      return;

    }

    let cancelled = false;

    void loadEntitlements().then(() => {

      if (cancelled) return;

    });

    return () => {

      cancelled = true;

    };

  }, [loadEntitlements, opts.cacheOnly, opts.enabled, opts.role]);



  useEffect(() => {

    if (opts.cacheOnly || !opts.enabled || !opts.role) return;

    const onSynced = () => {

      void loadEntitlements();

    };

    window.addEventListener(BILLING_CHECKOUT_SYNCED_EVENT, onSynced);

    return () => window.removeEventListener(BILLING_CHECKOUT_SYNCED_EVENT, onSynced);

  }, [loadEntitlements, opts.cacheOnly, opts.enabled, opts.role]);



  const hasFeature = useCallback(

    (featureKey: FeatureKey) => hasFeatureForTier(tier, featureKey, capabilities),

    [capabilities, tier],

  );



  const hasCapability = useCallback(

    (capability: SubscriptionCapability) =>

      hasSubscriptionCapability(tier, capability, capabilities),

    [capabilities, tier],

  );



  const tierFlags = useMemo(

    () => ({

      isNone: !hasActiveEntitlements,

      isBasic: tier === "basic",

      isPremium: tier === "premium",

      isEnterprise: tier === "enterprise",

    }),

    [hasActiveEntitlements, tier],

  );



  const advancedAnalyticsEnabled = hasCapability("advancedAnalytics");



  return {

    tier,

    status,

    accessSource,

    isSponsored,

    capabilities,

    limits,

    hasActiveEntitlements,

    ready,

    ...tierFlags,

    hasFeature,

    hasCapability,

    advancedAnalyticsEnabled,

  };

}



/** Business dashboard entitlement hook with explicit loading/ready flags. */

export function useBusinessEntitlements(opts: { enabled: boolean }) {

  const result = useSubscriptionEntitlements({

    enabled: opts.enabled,

    role: opts.enabled ? "business" : null,

  });

  return {

    ...result,

    entitlements: {

      tier: result.tier,

      status: result.status,

      accessSource: result.accessSource,

      isSponsored: result.isSponsored,

      capabilities: result.capabilities,

      limits: result.limits,

      hasActiveEntitlements: result.hasActiveEntitlements,

      hasFeature: result.hasFeature,

      hasCapability: result.hasCapability,

      advancedAnalyticsEnabled: result.advancedAnalyticsEnabled,

      isNone: result.isNone,

      isBasic: result.isBasic,

      isPremium: result.isPremium,

      isEnterprise: result.isEnterprise,

    },

    isLoading: opts.enabled && !result.ready,

    isReady: result.ready,

  };

}


