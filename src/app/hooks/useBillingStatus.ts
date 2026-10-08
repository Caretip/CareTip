import { useCallback, useEffect, useRef, useState } from "react";
import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import {
  fetchBillingStatus,
  type BillingStatus,
} from "../lib/api";
import { BILLING_CHECKOUT_SYNCED_EVENT } from "../lib/billingCheckoutSuccessSync";
import { isProtectedApiReady } from "../lib/authRestore";
import { subscribeAuthSessionFlags } from "../lib/authSessionBootstrap";
import { toUserFriendlyMessage } from "../lib/errorMessages";

/** Bounded wait — hung billing must not leave loading=true forever. */
export const BILLING_STATUS_REQUEST_TIMEOUT_MS = 30_000;

function useProtectedApiReady(): boolean {
  return useSyncExternalStore(
    subscribeAuthSessionFlags,
    () => isProtectedApiReady(),
    () => false,
  );
}

export function useBillingStatus() {
  const { t } = useTranslation();
  const apiReady = useProtectedApiReady();
  const [data, setData] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    if (!isProtectedApiReady()) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const timeoutId = window.setTimeout(() => {
      controller.abort();
    }, BILLING_STATUS_REQUEST_TIMEOUT_MS);

    setLoading(true);
    setError(null);
    try {
      const status = await fetchBillingStatus({ signal: controller.signal });
      if (controller.signal.aborted) return;
      setData(status);
    } catch (err) {
      if (abortRef.current !== controller) return;
      setError(toUserFriendlyMessage(err) || t("business.billing.loadError"));
    } finally {
      window.clearTimeout(timeoutId);
      const staleRequest =
        abortRef.current !== controller && abortRef.current !== null;
      if (!staleRequest) {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
        setLoading(false);
      }
    }
  }, [t]);

  useEffect(() => {
    if (!apiReady) {
      setLoading(true);
      return;
    }
    void reload();
  }, [apiReady, reload]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const onSynced = () => {
      void reload();
    };
    window.addEventListener(BILLING_CHECKOUT_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(BILLING_CHECKOUT_SYNCED_EVENT, onSynced);
  }, [reload]);

  return { data, loading, error, reload };
}
