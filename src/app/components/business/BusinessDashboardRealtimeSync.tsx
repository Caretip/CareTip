import { useEffect } from "react";
import { useDeferSocketConnect, useSocketInstance, useSocketStatus } from "../../hooks/useSocket";
import { useRealtimeFallback } from "../../hooks/useRealtimeFallback";
import { subscribeTipReceived } from "../../lib/realtime/subscribeTipReceived";
import { shouldProcessRealtimeEvent } from "../../lib/realtime/realtimeEventDedupe";
import type { LiveNewTipPayload } from "../../lib/realtime/realtimeContracts";

type BusinessDashboardRealtimeSyncProps = {
  enabled: boolean;
  businessId: string | undefined;
  refreshStatsQuiet: () => void;
  applyLiveTip: (payload: LiveNewTipPayload) => void;
};

/**
 * Headless: tip + business_data socket listeners and reconnect fallback.
 * Isolated so socket status churn does not re-render BusinessDashboard KPIs/charts.
 */
export function BusinessDashboardRealtimeSync({
  enabled,
  businessId,
  refreshStatsQuiet,
  applyLiveTip,
}: BusinessDashboardRealtimeSyncProps) {
  const socketReady = useDeferSocketConnect(enabled);
  const { socket } = useSocketInstance(socketReady);
  const { connected } = useSocketStatus();

  useRealtimeFallback(connected, () => {
    refreshStatsQuiet();
  });

  useEffect(() => {
    if (!socket || !enabled) return;
    const sync = () => refreshStatsQuiet();
    socket.on("business_data_updated", sync);
    socket.on("verification_updated", sync);
    return () => {
      socket.off("business_data_updated", sync);
      socket.off("verification_updated", sync);
    };
  }, [socket, enabled, refreshStatsQuiet]);

  useEffect(() => {
    if (!socket || !enabled || !businessId) return;

    return subscribeTipReceived(socket, (payload, eventId) => {
      if (!shouldProcessRealtimeEvent(eventId)) return;
      if (payload.businessId !== businessId) return;
      applyLiveTip(payload);
    });
  }, [socket, enabled, businessId, applyLiveTip]);

  return null;
}
