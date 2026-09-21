import { useCallback } from "react";
import { useStaleExternalStripeStateReset } from "./useStaleExternalStripeStateReset";

/**
 * Clears Connect / Express Dashboard redirect busy state on bfcache restore
 * or Stripe Connect return URL params.
 */
export function useClearStaleStripeRedirectBusy(
  setBusy: (value: null) => void,
  returnQueryKey: string,
  searchParams: URLSearchParams,
): void {
  const onReset = useCallback(() => setBusy(null), [setBusy]);
  useStaleExternalStripeStateReset({
    onReset,
    connectReturnKey: returnQueryKey,
    connectReturnParams: searchParams,
  });
}
