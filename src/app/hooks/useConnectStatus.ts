import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { type ConnectStatus } from "../lib/api";
import { fetchConnectStatusCached } from "../lib/stripeConnectStatusCache";
import { toUserFriendlyMessage } from "../lib/errorMessages";

export function useConnectStatus(enabled = true) {
  const { t } = useTranslation();
  const [data, setData] = useState<ConnectStatus | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      // Always a fresh read (revalidate), as before. Going through the shared cache also records it,
      // so the Stripe Connect page can paint this status at once instead of a loader.
      const status = await fetchConnectStatusCached({ revalidate: true });
      setData(status);
    } catch (err) {
      setError(toUserFriendlyMessage(err) || t("business.billing.connect.loadError"));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [enabled, t]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setError(null);
      setData(null);
      return;
    }
    void reload();
  }, [enabled, reload]);

  return { data, loading, error, reload };
}

/** True when Connect status has loaded and the venue is not yet ready to receive tips. */
export function connectNeedsSetup(data: ConnectStatus | null, loading: boolean, error: string | null): boolean {
  if (loading || error || !data) return false;
  return data.status !== "ready";
}
