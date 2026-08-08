/**
 * Pure helpers for post-return billing sync — unit-tested without RN/Expo.
 */

export type BillingSyncSnapshot = {
  synced: boolean;
  status?: string | null;
  subscriptionTier?: string | null;
  planKey?: string | null;
};

/** Entitled when webhook/sync marks synced, or tier is already Premium+. */
export function isBillingEntitlementConfirmed(snapshot: BillingSyncSnapshot): boolean {
  if (snapshot.synced) return true;
  const tier = String(snapshot.subscriptionTier ?? "").trim().toLowerCase();
  return tier === "premium" || tier === "enterprise";
}

export function didTierUpgrade(
  before: string | null | undefined,
  after: string | null | undefined,
): boolean {
  const a = String(before ?? "basic").trim().toLowerCase() || "basic";
  const b = String(after ?? "basic").trim().toLowerCase() || "basic";
  if (a === b) return false;
  const rank = (t: string) => (t === "enterprise" ? 3 : t === "premium" ? 2 : 1);
  return rank(b) > rank(a);
}

/** Bounded poll schedule: attempts × interval (defaults: 8 × 2s ≈ 16s). */
export const BILLING_RETURN_SYNC_MAX_ATTEMPTS = 8;
export const BILLING_RETURN_SYNC_INTERVAL_MS = 2_000;
