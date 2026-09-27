import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { CountUpMetric } from "../../../dashboard/CountUpMetric";
import {
  computeOperationalMetrics,
  type BusinessIntelligenceInput,
} from "../../../../lib/businessIntelligence";
import { cn } from "@/lib/utils";

type OperationalMetricsStripProps = {
  data: BusinessIntelligenceInput;
  loading?: boolean;
  shiftMetricLoading?: boolean;
  refreshing?: boolean;
  className?: string;
};

export const OperationalMetricsStrip = memo(function OperationalMetricsStrip({
  data,
  loading,
  shiftMetricLoading,
  refreshing = false,
  className,
}: OperationalMetricsStripProps) {
  const { t } = useTranslation();
  const ops = useMemo(() => computeOperationalMetrics(data), [data]);
  const showShift = ops.averageTipsPerShift != null || shiftMetricLoading === true;
  const showPlaceholder = loading && !refreshing;
  const shiftLoading = shiftMetricLoading === true || (loading && ops.averageTipsPerShift == null);

  const cells = [
    {
      id: "receiving",
      label: t("business.team.performance.bi.employeesWithTips"),
      value: showPlaceholder ? "—" : <CountUpMetric value={ops.employeesReceivingTips} kind="integer" />,
    },
    {
      id: "avg-emp",
      label: t("business.team.performance.bi.avgPerEmployee"),
      value: showPlaceholder ? "—" : <CountUpMetric value={ops.averageTipsPerEmployee} kind="eur" />,
    },
    ...(showShift
      ? [
          {
            id: "avg-shift",
            label: t("business.team.performance.bi.avgPerShift"),
            value:
              shiftLoading && !refreshing
                ? "—"
                : <CountUpMetric value={ops.averageTipsPerShift ?? 0} kind="eur" />,
          },
        ]
      : []),
  ];

  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-2 rounded-lg border border-border/60 bg-muted/10 p-3 sm:grid-cols-3 sm:gap-3",
        className,
      )}
    >
      {cells.map((cell) => (
        <div key={cell.id} className="min-w-0">
          <p className="text-[11px] font-medium text-muted-foreground">{cell.label}</p>
          <p className="text-base font-semibold tabular-nums">{cell.value}</p>
        </div>
      ))}
    </div>
  );
});
