import { useEffect } from "react";
import { Outlet } from "react-router";
import { useAuth } from "../hooks/useAuth";
import { fetchBusinessProfile, hasClientAccessToken } from "../lib/api";
import { BILLING_CHECKOUT_SYNCED_EVENT } from "../lib/billingCheckoutSuccessSync";
import { primeSubscriptionEntitlementsFromSession, migrateSubscriptionEntitlementsCacheIfNeeded } from "../lib/subscriptionSessionCache";
import { resolveSubscriptionTier } from "../lib/subscriptionCapabilities";
import { logClientError } from "../lib/clientLog";
import { isApiConnectivityError } from "../lib/errorMessages";

/**
 * Keeps manager subscription entitlements and split verification fields fresh.
 * Does not gate the dashboard shell — never unmount the outlet to an empty tree.
 */
export function ApprovedBusinessGate() {
  const { user, updateUser, sessionValidated, authStatus } = useAuth();

  const canSyncProfile =
    sessionValidated &&
    authStatus === "authenticated" &&
    hasClientAccessToken() &&
    user?.role === "business" &&
    !user.impersonation;

  const applyProfile = (p: Awaited<ReturnType<typeof fetchBusinessProfile>>) => {
    const tier = resolveSubscriptionTier(p.subscriptionTier);
    const accessSource = p.accessSource ?? (p.hasActiveSubscription ? "subscription" : "none");
    const status = p.subscriptionStatus ?? (accessSource !== "none" ? "active" : "none");
    primeSubscriptionEntitlementsFromSession({ tier, status, accessSource });
    updateUser({
      onboardingVerificationStatus: p.onboardingVerificationStatus,
    });
  };

  useEffect(() => {
    migrateSubscriptionEntitlementsCacheIfNeeded();
  }, []);

  useEffect(() => {
    if (!canSyncProfile) return;
    let cancelled = false;
    void fetchBusinessProfile({ silent: true })
      .then((p) => {
        if (cancelled) return;
        applyProfile(p);
      })
      .catch((err: unknown) => {
        if (!isApiConnectivityError(err)) {
          logClientError("ApprovedBusinessGate", err);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canSyncProfile, updateUser, user?.id]);

  useEffect(() => {
    if (!canSyncProfile) return;
    const refreshProfile = () => {
      if (!hasClientAccessToken()) return;
      void fetchBusinessProfile({ silent: true, revalidate: true })
        .then(applyProfile)
        .catch(() => {});
    };
    window.addEventListener("focus", refreshProfile);
    window.addEventListener(BILLING_CHECKOUT_SYNCED_EVENT, refreshProfile);
    return () => {
      window.removeEventListener("focus", refreshProfile);
      window.removeEventListener(BILLING_CHECKOUT_SYNCED_EVENT, refreshProfile);
    };
  }, [canSyncProfile, updateUser]);

  return <Outlet />;
}
