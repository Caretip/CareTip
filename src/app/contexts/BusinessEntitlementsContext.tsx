import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useAuth } from "../hooks/useAuth";
import { useSubscriptionEntitlements } from "../hooks/useSubscriptionEntitlements";

type BusinessEntitlementsValue = ReturnType<typeof useSubscriptionEntitlements>;

const BusinessEntitlementsContext = createContext<BusinessEntitlementsValue | null>(null);

/** Single entitlement fetch for the business dashboard shell. */
export function BusinessEntitlementsProvider({ children }: { children: ReactNode }) {
  const { user, authStatus } = useAuth();
  const enabled = authStatus === "authenticated" && user?.role === "business";
  const entitlements = useSubscriptionEntitlements({
    enabled,
    role: enabled ? "business" : null,
  });

  const value = useMemo(
    () => entitlements,
    // Intentionally primitive-only: function identities (hasFeature/hasCapability) must not
    // invalidate the shell/outlet on every entitlements hook render.
    [
      entitlements.tier,
      entitlements.status,
      entitlements.accessSource,
      entitlements.isSponsored,
      entitlements.hasActiveEntitlements,
      entitlements.ready,
      entitlements.isNone,
      entitlements.isBasic,
      entitlements.isPremium,
      entitlements.isEnterprise,
      entitlements.advancedAnalyticsEnabled,
      entitlements.limits,
      entitlements.capabilities,
    ],
  );

  return (
    <BusinessEntitlementsContext.Provider value={value}>{children}</BusinessEntitlementsContext.Provider>
  );
}

export function useBusinessEntitlementsContext(): BusinessEntitlementsValue | null {
  return useContext(BusinessEntitlementsContext);
}
