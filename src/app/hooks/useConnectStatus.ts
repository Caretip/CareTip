import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getConnectStatus, type ConnectStatus } from "../lib/api";
import { toUserFriendlyMessage } from "../lib/errorMessages";

export function useConnectStatus() {
  const { t } = useTranslation();
  const [data, setData] = useState<ConnectStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const status = await getConnectStatus();
      setData(status);
    } catch (err) {
      setError(toUserFriendlyMessage(err) || t("business.billing.connect.loadError"));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, loading, error, reload };
}

/** True when Connect status has loaded and the venue is not yet ready to receive tips. */
export function connectNeedsSetup(data: ConnectStatus | null, loading: boolean, error: string | null): boolean {
  if (loading || error || !data) return false;
  return data.status !== "ready";
}
