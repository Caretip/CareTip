import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Coins, TrendingUp, Wallet } from "lucide-react";
import { BusinessStatCard } from "../BusinessStatCard";
import { CountUpMetric } from "../../dashboard/CountUpMetric";
import { businessUi } from "../businessDashboardUi";
import { cn } from "@/lib/utils";
import {
  computeRevenueAnalytics,
  type BusinessIntelligenceInput,
} from "../../../lib/businessIntelligence";
import { formatEur } from "../../../lib/formatEur";

import type { AnalyticsTimeframe } from "../../../hooks/useBusinessDashboardStats";

type RevenueAnalyticsCardsProps = {
  data: BusinessIntelligenceInput;
  timeframe?: AnalyticsTimeframe;
  variant?: "full" | "detail";
  loading: boolean;
  refreshing?: boolean;
  refreshingLabel?: string;
  showHeading?: boolean;
};

export function RevenueAnalyticsCards({
  data,
  timeframe = "month",
  variant = "full",
  loading,
  refreshing = false,
  refreshingLabel,
  showHeading = true,
}: RevenueAnalyticsCardsProps) {
  const { t } = useTranslation();
  const revenue = useMemo(() => computeRevenueAnalytics(data), [data]);
  const tipCountHint =
    timeframe === "week"
      ? t("business.tips.analytics.cards.tipCountThisWeek", { count: revenue.tipCount })
      : timeframe === "year"
        ? t("business.tips.analytics.cards.tipCountThisYear", { count: revenue.tipCount })
        : t("business.tips.analytics.cards.tipCountThisMonth", { count: revenue.tipCount });
  const showVolume = variant === "full";
  const showWeekly = timeframe !== "week";
  const cardCount = Number(showVolume) + 1 + 1 + Number(showWeekly);

  return (
    <section className="space-y-3">
      {showHeading ? (
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t("business.team.performance.bi.revenueTitle")}
        </h2>
      ) : null}
      <div className={cn(businessUi.statsGrid, cardCount >= 4 ? "lg:grid-cols-4" : "lg:grid-cols-3")}>
        {showVolume ? (
        <BusinessStatCard
          featured
          loading={loading}
          refreshing={refreshing}
          refreshingLabel={refreshingLabel}
          loadingVariant="currency"
          label={t("business.team.performance.bi.totalTips")}
          value={<CountUpMetric value={revenue.totalTips} kind="eur" />}
          change={tipCountHint}
          icon={<Coins className="h-5 w-5" aria-hidden />}
        />
        ) : null}
        <BusinessStatCard
          loading={loading}
          refreshing={refreshing}
          refreshingLabel={refreshingLabel}
          label={t("business.team.performance.bi.tipGrowth")}
          value={<CountUpMetric value={revenue.growthPercent} kind="percent" />}
          change={t("business.team.performance.bi.tipGrowthHint")}
          icon={<TrendingUp className="h-5 w-5" aria-hidden />}
        />
        <BusinessStatCard
          loading={loading}
          refreshing={refreshing}
          refreshingLabel={refreshingLabel}
          label={t("business.team.performance.bi.avgTip")}
          value={<CountUpMetric value={revenue.averageTip} kind="eur" />}
          icon={<Wallet className="h-5 w-5" aria-hidden />}
        />
        {showWeekly ? (
        <BusinessStatCard
          loading={loading}
          refreshing={refreshing}
          refreshingLabel={refreshingLabel}
          label={t("business.team.performance.bi.weeklyRevenue")}
          value={<CountUpMetric value={revenue.weeklyRevenue} kind="eur" />}
          change={t("business.team.performance.bi.periodRevenueHint", {
            amount: formatEur(revenue.periodRevenue),
          })}
          icon={<Wallet className="h-5 w-5" aria-hidden />}
        />
        ) : null}
      </div>
    </section>
  );
}
