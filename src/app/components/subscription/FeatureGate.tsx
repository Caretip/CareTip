import type { ReactNode } from "react";
import type { FeatureKey } from "@/app/lib/subscriptionCapabilities";
import { useSubscriptionEntitlements } from "@/app/hooks/useSubscriptionEntitlements";
import { useBusinessEntitlementsContext } from "@/app/contexts/BusinessEntitlementsContext";
import { useEmployeeEntitlementsContext } from "@/app/contexts/EmployeeEntitlementsContext";
import {
  isEntitlementsSessionPrimed,
  sessionHasFeature,
  sessionResolvedTier,
  sessionSubscriptionStatus,
} from "@/app/lib/subscriptionEntitlementFastPath";
import { LockedFeatureCard } from "./LockedFeatureCard";
import { FeatureGatePending } from "./FeatureGatePending";

type FeatureGateProps = {
  featureKey: FeatureKey;
  role: "business" | "employee";
  enabled?: boolean;
  children: ReactNode;
  fallback?: ReactNode;
  /** When false, render nothing instead of LockedFeatureCard */
  showLockedCard?: boolean;
  /** Custom locked UI (e.g. dashboard ProUpgradeCard for full modules). */
  lockedFallback?: ReactNode;
  lockedCardCompact?: boolean;
  lockedCardClassName?: string;
};

function useEntitlementsForGate(role: "business" | "employee", enabled: boolean) {
  const businessContext = useBusinessEntitlementsContext();
  const employeeContext = useEmployeeEntitlementsContext();
  const useSharedBusiness = enabled && role === "business" && businessContext != null;
  const useSharedEmployee = enabled && role === "employee" && employeeContext != null;
  const fallback = useSubscriptionEntitlements({
    enabled: enabled && !useSharedBusiness && !useSharedEmployee,
    role: enabled ? role : null,
  });
  if (useSharedBusiness) return businessContext;
  if (useSharedEmployee) return employeeContext;
  return fallback;
}

export function FeatureGate({
  featureKey,
  role,
  enabled = true,
  children,
  fallback,
  showLockedCard = true,
  lockedFallback,
  lockedCardCompact = true,
  lockedCardClassName,
}: FeatureGateProps) {
  const { tier, status, ready, hasFeature } = useEntitlementsForGate(role, enabled);

  if (!enabled) return null;

  if (ready && hasFeature(featureKey)) return <>{children}</>;

  if (isEntitlementsSessionPrimed() && !sessionHasFeature(featureKey)) {
    if (fallback) return <>{fallback}</>;
    if (!showLockedCard) return null;
    if (lockedFallback) return <>{lockedFallback}</>;
    return (
      <LockedFeatureCard
        featureKey={featureKey}
        tier={sessionResolvedTier()}
        subscriptionStatus={sessionSubscriptionStatus() ?? "none"}
        compact={lockedCardCompact}
        className={lockedCardClassName}
      />
    );
  }

  if (!ready) {
    if (fallback) return <>{fallback}</>;
    return <FeatureGatePending compact={lockedCardCompact} className={lockedCardClassName} />;
  }

  if (fallback) return <>{fallback}</>;
  if (!showLockedCard) return null;
  if (lockedFallback) return <>{lockedFallback}</>;

  return (
    <LockedFeatureCard
      featureKey={featureKey}
      tier={tier}
      subscriptionStatus={status}
      compact={lockedCardCompact}
      className={lockedCardClassName}
    />
  );
}
