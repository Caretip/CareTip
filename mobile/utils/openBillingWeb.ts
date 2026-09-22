import { useBillingWebInfoStore } from "@/store/billingWebInfoStore";

export type OpenBillingWebOptions = {
  /** @deprecated No longer used — billing opens as a normal external website link. */
  confirm?: boolean;
};

/**
 * Shows an informational popup explaining that subscription management
 * happens on caretip.de. The website opens externally with no handoff token,
 * JWT, or automatic authentication.
 */
export function showBillingWebInfo(_opts?: OpenBillingWebOptions): void {
  useBillingWebInfoStore.getState().open();
}

/** @deprecated Use showBillingWebInfo — authenticated handoff is no longer used. */
export const openAuthenticatedBillingWeb = showBillingWebInfo;
