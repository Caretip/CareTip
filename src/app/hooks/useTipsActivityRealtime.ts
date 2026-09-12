import { useEffect, useRef } from "react";
import { useDashboardTabRefocus } from "./useDashboardTabRefocus";
import { useRealtimeFallback } from "./useRealtimeFallback";
import { useDeferSocketConnect, useSocketInstance, useSocketStatus } from "./useSocket";
import type { LiveNewTipPayload } from "../lib/realtime/realtimeContracts";
import { shouldProcessRealtimeEvent, tipRealtimeDedupeId } from "../lib/realtime/realtimeEventDedupe";
import { subscribeTipReceived } from "../lib/realtime/subscribeTipReceived";
import { useSocketCatchUp } from "../lib/realtime/useRealtimeReconnect";

type TipsActivityRealtimeArgs = {
  enabled: boolean;
  role: string | undefined;
  businessId?: string;
  employeeId?: string;
  variant: "default" | "employee-history";
  onLiveTip: (payload: LiveNewTipPayload) => void;
  onCatchUp: () => void;
};

/**
 * Tip ledger pages subscribe to the same backend `tip.received` contract as dashboards.
 * Realtime is a delivery hint; `onCatchUp` reconciles from the API.
 */
export function useTipsActivityRealtime({
  enabled,
  role,
  businessId,
  employeeId,
  variant,
  onLiveTip,
  onCatchUp,
}: TipsActivityRealtimeArgs): void {
  const socketReady = useDeferSocketConnect(enabled);
  const { socket } = useSocketInstance(socketReady);
  const { connected } = useSocketStatus();

  const onLiveTipRef = useRef(onLiveTip);
  onLiveTipRef.current = onLiveTip;
  const onCatchUpRef = useRef(onCatchUp);
  onCatchUpRef.current = onCatchUp;

  useEffect(() => {
    if (!socket || !enabled) return;

    return subscribeTipReceived(socket, (payload, eventId) => {
      if (!shouldProcessRealtimeEvent(tipRealtimeDedupeId(payload, eventId), "tips-activity")) {
        return;
      }
      if (role === "business" && businessId && payload.businessId !== businessId) return;
      if (
        variant === "employee-history" &&
        employeeId &&
        payload.employeeId &&
        payload.employeeId !== employeeId
      ) {
        return;
      }
      onLiveTipRef.current(payload);
    });
  }, [socket, enabled, role, businessId, employeeId, variant]);

  const catchUp = () => {
    onCatchUpRef.current();
  };

  useSocketCatchUp(catchUp, enabled);
  useDashboardTabRefocus(catchUp, enabled);
  useRealtimeFallback(connected, catchUp);
}
