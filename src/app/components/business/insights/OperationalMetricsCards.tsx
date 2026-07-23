import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Clock, UserCheck, Users, Wallet } from "lucide-react";
import { BusinessStatCard } from "../BusinessStatCard";
import { CountUpMetric } from "../../dashboard/CountUpMetric";
import { businessUi } from "../businessDashboardUi";
import { cn } from "@/lib/utils";
import {
  computeOperationalMetrics,
  type BusinessIntelligenceInput,
} from "../../../lib/businessIntelligence";

type OperationalMetricsCardsProps = {
  data: BusinessIntelligenceInput;
  loading: boolean;
  refreshing?: boolean;
  refreshingLabel?: string;
};

export function OperationalMetricsCards({
  data,
  loading,
  refreshing = false,
  refreshingLabel,
}: OperationalMetricsCardsProps) {
  const { t } = useTranslation();
  const ops = useMemo(() => computeOperationalMetrics(data), [data]);
  const showShift = ops.averageTipsPerShift != null;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {t("business.team.performance.bi.operationalTitle")}
      </h2>
      <div className={cn(businessUi.statsGrid, showShift ? "lg:grid-cols-4" : "lg:grid-cols-3")}>
        <BusinessStatCard
          loading={loading}
          refreshing={refreshing}
          refreshingLabel={refreshingLabel}
          label={t("business.team.performance.bi.activeEmployees")}
          value={<CountUpMetric value={ops.activeEmployees} kind="integer" />}
          icon={<Users className="h-5 w-5" aria-hidden />}
        />
        <BusinessStatCard
          loading={loading}
          refreshing={refreshing}
          refreshingLabel={refreshingLabel}
          label={t("business.team.performance.bi.employeesWithTips")}
          value={<CountUpMetric value={ops.employeesReceivingTips} kind="integer" />}
          icon={<UserCheck className="h-5 w-5" aria-hidden />}
        />
        <BusinessStatCard
          loading={loading}
          refreshing={refreshing}
          refreshingLabel={refreshingLabel}
          label={t("business.team.performance.bi.avgPerEmployee")}
          value={<CountUpMetric value={ops.averageTipsPerEmployee} kind="eur" />}
          icon={<Wallet className="h-5 w-5" aria-hidden />}
        />
        {showShift ? (
          <BusinessStatCard
            loading={loading}
            refreshing={refreshing}
            refreshingLabel={refreshingLabel}
            label={t("business.team.performance.bi.avgPerShift")}
            value={<CountUpMetric value={ops.averageTipsPerShift ?? 0} kind="eur" />}
            icon={<Clock className="h-5 w-5" aria-hidden />}
          />
        ) : null}
      </div>
    </section>
  );
}
