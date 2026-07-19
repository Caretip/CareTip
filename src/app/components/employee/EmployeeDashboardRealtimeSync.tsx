import { useEffect, useRef } from "react";
import { useDeferSocketConnect, useSocketInstance, useSocketStatus } from "../../hooks/useSocket";
import { useRealtimeFallback } from "../../hooks/useRealtimeFallback";
import { useDashboardTabRefocus } from "../../hooks/useDashboardTabRefocus";
import { subscribeTipReceived } from "../../lib/realtime/subscribeTipReceived";
import { recordNewEmployeeTip } from "../../lib/employeeNotificationStore";
import { playChaChingSound } from "../../lib/tipSounds";
import { isProtectedApiReady } from "../../lib/authRestore";
import type { TipItem } from "../../lib/api";

type LiveTipArgs = {
  tip: TipItem;
  employeeId: string;
  currentMonthTotal: number;
  monthlyGoal: number | null;
};

type EmployeeDashboardRealtimeSyncProps = {
  enabled: boolean;
  employeeId: string | undefined;
  dashboardDataReady: boolean;
  refreshDashboardQuiet: () => void;
  applyLiveTip: (args: LiveTipArgs) => void;
};

/**
 * Headless: tip socket + reconnect/tab refresh for employee overview.
 * Keeps socket status updates out of EmployeeDashboard KPI/chart commits.
 */
export function EmployeeDashboardRealtimeSync({
  enabled,
  employeeId,
  dashboardDataReady,
  refreshDashboardQuiet,
  applyLiveTip,
}: EmployeeDashboardRealtimeSyncProps) {
  const socketReady = useDeferSocketConnect(enabled && isProtectedApiReady());
  const { socket } = useSocketInstance(socketReady);
  const { connected } = useSocketStatus();
  const refreshTimerRef = useRef<number | null>(null);

  useRealtimeFallback(connected, refreshDashboardQuiet);
  useDashboardTabRefocus(refreshDashboardQuiet, dashboardDataReady);

  useEffect(() => {
    if (!socket || !employeeId) return;

    return subscribeTipReceived(socket, (payload) => {
      if (payload.employeeId !== employeeId) return;

      recordNewEmployeeTip(employeeId, payload.tip);

      applyLiveTip({
        tip: payload.tip,
        employeeId: payload.employeeId,
        currentMonthTotal: payload.currentMonthTotal ?? 0,
        monthlyGoal: payload.monthlyGoal ?? null,
      });

      if (refreshTimerRef.current != null) window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        void refreshDashboardQuiet();
      }, 900);

      playChaChingSound();
    });
  }, [socket, employeeId, refreshDashboardQuiet, applyLiveTip]);

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current != null) window.clearTimeout(refreshTimerRef.current);
    };
  }, []);

  return null;
}
