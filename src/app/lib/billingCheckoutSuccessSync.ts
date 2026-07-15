import {
  clearBusinessProfileClientCache,
  fetchBillingSyncStatus,
  fetchBusinessProfile,
  type BillingSyncStatus,
  type SubscriptionPlanKey,
} from "./api";
import {
  clearCheckoutSyncExpectation,
  getCheckoutSyncExpectation,
} from "./checkoutIntent";
import { resolveSubscriptionTier } from "./subscriptionCapabilities";
import {
  clearSubscriptionTierSession,
  primeSubscriptionEntitlementsFromSession,
} from "./subscriptionSessionCache";
import { withIdleSuppress } from "./idleSuppress";

export const BILLING_CHECKOUT_SYNCED_EVENT = "caretip:billing-checkout-synced";

const POLL_INTERVAL_MS = 2000;
const MAX_ATTEMPTS = 45;

function primeEntitlementsFromSyncStatus(status: BillingSyncStatus): void {
  if (!status.subscriptionTier || status.status === "none" || !status.status) return;
  const tier = resolveSubscriptionTier(status.subscriptionTier);
  primeSubscriptionEntitlementsFromSession({ tier, status: status.status });
}

async function primeEntitlementsFromProfile(): Promise<void> {
  const profile = await fetchBusinessProfile({ silent: true, revalidate: true });
  const tier = resolveSubscriptionTier(profile.subscriptionTier);
  const status = profile.subscriptionStatus ?? (tier ? "active" : "none");
  primeSubscriptionEntitlementsFromSession({ tier, status });
}

/**
 * Poll billing sync-status until the Stripe webhook mirror is entitled, then refresh
 * profile + session entitlement caches and notify listeners.
 */
export async function runBillingCheckoutSuccessSync(opts?: {
  expectedPlan?: SubscriptionPlanKey;
}): Promise<boolean> {
  return withIdleSuppress("billing-checkout-sync", async () => {
    const expectedPlan = opts?.expectedPlan ?? getCheckoutSyncExpectation() ?? undefined;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      try {
        const result = await fetchBillingSyncStatus(expectedPlan);
        if (result.synced) {
          clearCheckoutSyncExpectation();
          clearBusinessProfileClientCache();
          clearSubscriptionTierSession();
          try {
            await primeEntitlementsFromProfile();
          } catch {
            primeEntitlementsFromSyncStatus(result);
          }
          window.dispatchEvent(new CustomEvent(BILLING_CHECKOUT_SYNCED_EVENT));
          return true;
        }
      } catch {
        // Webhook may still be in flight.
      }
      await new Promise((resolve) => window.setTimeout(resolve, POLL_INTERVAL_MS));
    }

    return false;
  });
}
