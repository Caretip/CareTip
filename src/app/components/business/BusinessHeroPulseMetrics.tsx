import { memo } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { CountUpMetric } from "../dashboard/CountUpMetric";
import { DashboardHeroMetricSkeleton } from "../dashboard/DashboardAnalyticsLoader";
import { formatEur } from "../../lib/formatEur";

export type BusinessHeroOperationalPulse = {
  tipsLast60m: { count: number; amount: number };
  tipsToday: { count: number; amount: number };
};

type BusinessHeroPulseMetricsProps = {
  loading: boolean;
  pulse: BusinessHeroOperationalPulse | null;
  isRefreshing?: boolean;
  className?: string;
};

function PulseValue({
  loading,
  count,
  amount,
}: {
  loading: boolean;
  count: number | null;
  amount: number | null;
}) {
  const { t } = useTranslation();
  const hasTips = count != null && count > 0;

  return (
    <>
      {loading ? (
        <DashboardHeroMetricSkeleton variant="pulse" />
      ) : count != null ? (
        <>
          <span className="dashboard-hero-metric-value--live">
            <CountUpMetric
              value={count}
              kind="integer"
              format={(n) => {
                const rounded = Math.round(n);
                return rounded === 0
                  ? t("format.metricZeroTips")
                  : t("business.hero.pulse.tipsCount", { count: rounded });
              }}
            />
          </span>
          {hasTips && amount != null ? (
            <span className="business-hero-pulse-subline dashboard-hero-metric-value--live text-muted-foreground/90">
              <CountUpMetric
                value={amount}
                kind="eur"
                format={(n) => t("business.hero.pulse.volume", { amount: formatEur(n) })}
              />
            </span>
          ) : null}
        </>
      ) : (
        <span className="block">{t("format.noDataYet")}</span>
      )}
    </>
  );
}

export const BusinessHeroPulseMetrics = memo(function BusinessHeroPulseMetrics({
  loading,
  pulse,
  isRefreshing,
  className,
}: BusinessHeroPulseMetricsProps) {
  const { t } = useTranslation();

  return (
    <dl
      className={cn(
        "business-hero-account-stats business-hero-account-stats--open dashboard-swr-swap",
        loading && "dashboard-hero-account-stats--loading",
        isRefreshing && "dashboard-swr-swap--revalidating",
        className,
      )}
      aria-label={t("business.hero.pulse.sectionLabel")}
      aria-busy={loading}
    >
      <div>
        <dt>{t("business.hero.pulse.lastHour")}</dt>
        <dd>
          <PulseValue
            loading={loading}
            count={pulse?.tipsLast60m.count ?? null}
            amount={pulse?.tipsLast60m.amount ?? null}
          />
        </dd>
      </div>
      <div>
        <dt>{t("business.hero.pulse.today")}</dt>
        <dd>
          <PulseValue
            loading={loading}
            count={pulse?.tipsToday.count ?? null}
            amount={pulse?.tipsToday.amount ?? null}
          />
        </dd>
      </div>
    </dl>
  );
});
