import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSocketStatus } from "../../hooks/useSocket";
import { DashboardStatusStrip } from "../dashboard/DashboardStatusStrip";
import {
  deriveBusinessDashboardStatus,
  deriveEmployeeDashboardStatus,
} from "../../lib/dashboardStatus/deriveDashboardStatus";

type SharedStatusProps = {
  hasVisibleMetrics: boolean;
  statsLoadFailed: string | null;
};

type BusinessProps = SharedStatusProps & {
  role: "business";
  pendingVerification: boolean;
  isPeriodSyncing?: boolean;
  isMetricsSettled?: boolean;
  hasPeriodActivity?: boolean;
};

type EmployeeProps = SharedStatusProps & {
  role: "employee";
  isPeriodSyncing?: boolean;
  isMetricsSettled?: boolean;
  hasPeriodActivity?: boolean;
};

/**
 * Owns `useSocketStatus` so connection-flag churn only re-renders this strip,
 * not the parent dashboard KPI/chart tree.
 */
export const DashboardRealtimeStatusStrip = memo(function DashboardRealtimeStatusStrip(
  props: BusinessProps | EmployeeProps,
) {
  const { t } = useTranslation();
  const { connectionStatus } = useSocketStatus();

  const items = useMemo(() => {
    const base = {
      isPeriodSyncing: props.isPeriodSyncing ?? false,
      isMetricsSettled: props.isMetricsSettled ?? false,
      hasPeriodActivity: props.hasPeriodActivity ?? false,
      hasVisibleMetrics: props.hasVisibleMetrics,
      statsLoadFailed: props.statsLoadFailed,
      socketStatus: connectionStatus,
    };
    if (props.role === "business") {
      return deriveBusinessDashboardStatus(
        { ...base, pendingVerification: props.pendingVerification },
        t,
      );
    }
    return deriveEmployeeDashboardStatus(base, t);
  }, [
    props.role,
    props.isPeriodSyncing,
    props.isMetricsSettled,
    props.hasPeriodActivity,
    props.hasVisibleMetrics,
    props.statsLoadFailed,
    props.role === "business" ? props.pendingVerification : false,
    connectionStatus,
    t,
  ]);

  return <DashboardStatusStrip items={items} />;
});