import { useCallback, useEffect, useRef, useState } from "react";
import { getBusinessQrAnalytics, type BusinessQrAnalytics, type BusinessQrAnalyticsTimeframe } from "../lib/api";
import { logClientError } from "../lib/clientLog";
import { useSocket, useDeferSocketConnect } from "./useSocket";
import { useRealtimeFallback } from "./useRealtimeFallback";
import { useRealtimeReconnect } from "../lib/realtime/useRealtimeReconnect";
import { REALTIME_EVENTS } from "../lib/realtime/realtimeContracts";
import { shouldProcessRealtimeEvent } from "../lib/realtime/realtimeEventDedupe";
import { trackQrRefetch } from "../lib/realtime/realtimeMetrics";

export function useBusinessQrAnalytics(
  enabled: boolean,
  timeframe: BusinessQrAnalyticsTimeframe = "month",
) {
  const [data, setData] = useState<BusinessQrAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reconcileRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      trackQrRefetch();
      const result = await getBusinessQrAnalytics(timeframe);
      setData(result);
    } catch (err) {
      logClientError("useBusinessQrAnalytics", err);
      setData(null);
      setError("load_failed");
    } finally {
      setLoading(false);
    }
  }, [enabled, timeframe]);

  const scheduleReconcile = useCallback(() => {
    if (reconcileRef.current) clearTimeout(reconcileRef.current);
    reconcileRef.current = setTimeout(() => {
      reconcileRef.current = null;
      void load();
    }, 3_000);
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  const socketReady = useDeferSocketConnect(enabled);
  const { socket, connected } = useSocket(socketReady);

  useRealtimeFallback(connected, load);
  useRealtimeReconnect(load, enabled);

  useEffect(() => {
    if (!socket || !enabled) return;
    const onQr = (raw: { eventId?: string }) => {
      if (!shouldProcessRealtimeEvent(raw.eventId)) return;
      scheduleReconcile();
    };
    socket.on(REALTIME_EVENTS.QR_SCANNED, onQr);
    return () => {
      socket.off(REALTIME_EVENTS.QR_SCANNED, onQr);
    };
  }, [socket, enabled, scheduleReconcile]);

  useEffect(
    () => () => {
      if (reconcileRef.current) clearTimeout(reconcileRef.current);
    },
    [],
  );

  return { data, loading, error, refresh: load, connected };
}

