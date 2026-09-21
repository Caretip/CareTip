import { useEffect } from "react";
import {
  isBillingStripeReturnParam,
  isConnectStripeReturnParam,
  isPhysicalQrCheckoutReturnParam,
  isTipCheckoutCanceledParam,
  subscribeBfcacheRestore,
} from "../lib/staleExternalStripeState";

export type StaleExternalStripeStateResetOptions = {
  /** Clears local busy/processing/launch state — not payment or subscription results. */
  onReset: () => void;
  /** `?billing=success|canceled` checkout return. */
  billingReturn?: URLSearchParams;
  /** Connect-style return key, e.g. `connect` or `payoutConnect`. */
  connectReturnKey?: string;
  connectReturnParams?: URLSearchParams;
  /** Tip cancel return via `/payment?canceled=1` → tip-amount. */
  tipCanceled?: URLSearchParams;
  /** Physical QR Stripe return — clears pay-launch UI only. */
  physicalQrCheckoutReturn?: URLSearchParams;
};

/**
 * Reset stale external-Stripe transition state after bfcache or explicit return/cancel.
 * Does not run on normal first mount.
 */
export function useStaleExternalStripeStateReset(
  options: StaleExternalStripeStateResetOptions,
): void {
  const {
    onReset,
    billingReturn,
    connectReturnKey,
    connectReturnParams,
    tipCanceled,
    physicalQrCheckoutReturn,
  } = options;

  useEffect(() => subscribeBfcacheRestore(onReset), [onReset]);

  useEffect(() => {
    if (!billingReturn) return;
    if (isBillingStripeReturnParam(billingReturn.get("billing"))) onReset();
  }, [billingReturn, onReset]);

  useEffect(() => {
    if (!connectReturnKey || !connectReturnParams) return;
    if (isConnectStripeReturnParam(connectReturnParams.get(connectReturnKey))) onReset();
  }, [connectReturnKey, connectReturnParams, onReset]);

  useEffect(() => {
    if (!tipCanceled) return;
    if (isTipCheckoutCanceledParam(tipCanceled)) onReset();
  }, [tipCanceled, onReset]);

  useEffect(() => {
    if (!physicalQrCheckoutReturn) return;
    if (isPhysicalQrCheckoutReturnParam(physicalQrCheckoutReturn.get("checkout"))) onReset();
  }, [physicalQrCheckoutReturn, onReset]);
}
