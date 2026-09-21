/**
 * Stale client transition state after external Stripe navigation.
 * Clears only on bfcache restore (pageshow + persisted) or explicit return/cancel params —
 * never on ordinary first mount or forward navigation to Stripe.
 */

export function subscribeBfcacheRestore(onRestore: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = (event: PageTransitionEvent) => {
    if (event.persisted) onRestore();
  };
  window.addEventListener("pageshow", handler);
  return () => window.removeEventListener("pageshow", handler);
}

export function isBillingStripeReturnParam(value: string | null | undefined): boolean {
  return value === "success" || value === "canceled";
}

export function isConnectStripeReturnParam(value: string | null | undefined): boolean {
  return value === "return" || value === "refresh";
}

export function isTipCheckoutCanceledParam(searchParams: URLSearchParams): boolean {
  return searchParams.get("canceled") === "1";
}

/** Payment-launch UI only — does not alter order/payment verification state. */
export function isPhysicalQrCheckoutReturnParam(value: string | null | undefined): boolean {
  return value === "success" || value === "cancel";
}
