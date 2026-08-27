import { memo } from "react";
import { Clock, CalendarDays } from "lucide-react";
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

type PulseCardProps = {
  icon: "clock" | "calendar";
  tone: "amber" | "orange";
  label: string;
  loading: boolean;
  count: number | null;
  amount: number | null;
};

function PulseCard({ icon, tone, label, loading, count, amount }: PulseCardProps) {
  const { t } = useTranslation();
  const Icon = icon === "clock" ? Clock : CalendarDays;
  const hasTips = count != null && count > 0;

  return (
    <article
      className={cn(
        "business-hero-pulse-card",
        tone === "amber" ? "business-hero-pulse-card--amber" : "business-hero-pulse-card--orange",
      )}
    >
      <div className="business-hero-pulse-card__header">
        <div className="business-hero-pulse-card__icon" aria-hidden>
          <Icon className="business-hero-pulse-card__icon-glyph" strokeWidth={2.25} />
        </div>
        <p className="business-hero-pulse-card__label">{label}</p>
      </div>
      <div className="business-hero-pulse-card__value">
        {loading ? (
          <DashboardHeroMetricSkeleton variant="pulse" />
        ) : count != null ? (
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
        ) : (
          <span>{t("format.noDataYet")}</span>
        )}
      </div>
      <p className="business-hero-pulse-card__sub">
        {loading ? (
          "\u00a0"
        ) : hasTips && amount != null ? (
          <span className="dashboard-hero-metric-value--live">
            <CountUpMetric
              value={amount}
              kind="eur"
              format={(n) => t("business.hero.pulse.volume", { amount: formatEur(n) })}
            />
          </span>
        ) : (
          t("format.noDataYet")
        )}
      </p>
    </article>
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
    <div
      className={cn(
        "business-hero-pulse-grid dashboard-swr-swap",
        loading && "dashboard-hero-account-stats--loading",
        isRefreshing && "dashboard-swr-swap--revalidating",
        className,
      )}
      role="group"
      aria-label={t("business.hero.pulse.sectionLabel")}
      aria-busy={loading}
    >
      <PulseCard
        icon="clock"
        tone="amber"
        label={t("business.hero.pulse.lastHour")}
        loading={loading}
        count={pulse?.tipsLast60m.count ?? null}
        amount={pulse?.tipsLast60m.amount ?? null}
      />
      <PulseCard
        icon="calendar"
        tone="orange"
        label={t("business.hero.pulse.today")}
        loading={loading}
        count={pulse?.tipsToday.count ?? null}
        amount={pulse?.tipsToday.amount ?? null}
      />
    </div>
  );
});
