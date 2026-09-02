import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useAuth } from "../hooks/useAuth";
import { useSubscriptionEntitlements } from "../hooks/useSubscriptionEntitlements";

type EmployeeEntitlementsValue = ReturnType<typeof useSubscriptionEntitlements>;

const EmployeeEntitlementsContext = createContext<EmployeeEntitlementsValue | null>(null);

/** Single entitlement fetch for the employee dashboard shell. */
export function EmployeeEntitlementsProvider({ children }: { children: ReactNode }) {
  const { user, authStatus } = useAuth();
  const enabled = authStatus === "authenticated" && user?.role === "employee";
  const entitlements = useSubscriptionEntitlements({
    enabled,
    role: enabled ? "employee" : null,
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
    <EmployeeEntitlementsContext.Provider value={value}>{children}</EmployeeEntitlementsContext.Provider>
  );
}

export function useEmployeeEntitlementsContext(): EmployeeEntitlementsValue | null {
  return useContext(EmployeeEntitlementsContext);
}
