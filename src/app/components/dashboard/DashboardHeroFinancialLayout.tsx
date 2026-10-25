import type { ReactNode } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export type DashboardHeroFinancialMetric = {
  id: string;
  label: string;
  value: ReactNode;
  hint?: string;
  valueClassName?: string;
  /** Small icon beside the label. The amount stays plain. */
  icon?: ReactNode;
};

export type DashboardHeroFinancialLayoutProps = {
  ariaLabel: string;
  loading?: boolean;
  refreshing?: boolean;
  primary: {
    label: string;
    meta?: string;
    value: ReactNode;
    hint?: string;
  };
  /** Omit or leave empty to hide the payout zone heading (saves vertical space). */
  payoutZoneLabel?: string;
  payoutMetrics: DashboardHeroFinancialMetric[];
  performanceZoneLabel?: string;
  performanceMetrics?: DashboardHeroFinancialMetric[];
  analyticsHref?: string;
  analyticsLabel?: string;
  className?: string;
};

export function DashboardHeroFinancialLayout({
  ariaLabel,
  loading,
  refreshing,
  primary,
  payoutZoneLabel,
  payoutMetrics,
  performanceZoneLabel,
  performanceMetrics,
  analyticsHref,
  analyticsLabel,
  className,
}: DashboardHeroFinancialLayoutProps) {
  const { t } = useTranslation();
  const detailItems = [
    primary.hint ? { id: "primary", label: primary.label, hint: primary.hint } : null,
    ...payoutMetrics
      .filter((metric) => metric.hint)
      .map((metric) => ({ id: metric.id, label: metric.label, hint: metric.hint as string })),
  ].filter((item): item is { id: string; label: string; hint: string } => item != null);

  return (
    <section
      className={cn(
        "dashboard-hero-financial dashboard-swr-swap",
        loading && "dashboard-hero-financial--loading",
        refreshing && "dashboard-swr-swap--revalidating",
        className,
      )}
      aria-label={ariaLabel}
      aria-busy={loading}
    >
      <div className="dashboard-hero-financial__zone dashboard-hero-financial__zone--primary">
        <p className="dashboard-hero-financial__label">
          {primary.label}
          {primary.meta ? (
            <span className="dashboard-hero-financial__label-meta"> · {primary.meta}</span>
          ) : null}
        </p>
        <div className="dashboard-hero-financial__value dashboard-hero-financial__value--primary">
          {primary.value}
        </div>
        {primary.hint ? (
          <div className="dashboard-hero-financial__hint-slot">
            <p className="dashboard-hero-financial__hint">{primary.hint}</p>
          </div>
        ) : null}
      </div>

      <div className="dashboard-hero-financial__zone dashboard-hero-financial__zone--payout">
        {payoutZoneLabel ? (
          <p className="dashboard-hero-financial__zone-title">{payoutZoneLabel}</p>
        ) : null}
        <div className="dashboard-hero-financial__payout-grid">
          {payoutMetrics.map((metric) => (
            <div key={metric.id} className="dashboard-hero-financial__payout-cell">
              <MetricLabel label={metric.label} icon={metric.icon} />
              <div
                className={cn(
                  "dashboard-hero-financial__value dashboard-hero-financial__value--payout",
                  metric.valueClassName,
                )}
              >
                {metric.value}
              </div>
              {metric.hint ? (
                <p className="dashboard-hero-financial__hint">{metric.hint}</p>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      {detailItems.length > 0 ? (
        <details className="dashboard-hero-financial__details">
          <summary>{t("dashboardHero.financialDetails")}</summary>
          <dl>
            {detailItems.map((item) => (
              <div key={item.id}>
                <dt>{item.label}</dt>
                <dd>{item.hint}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}

      {performanceMetrics && performanceMetrics.length > 0 ? (
        <div
          className={cn(
            "dashboard-hero-financial__zone dashboard-hero-financial__zone--performance",
            loading && "dashboard-hero-financial__zone--performance-reserved",
          )}
        >
          {performanceZoneLabel ? (
            <p className="dashboard-hero-financial__zone-title">{performanceZoneLabel}</p>
          ) : null}
          <div className="dashboard-hero-financial__perf-grid">
            {performanceMetrics.map((metric) => (
              <div key={metric.id} className="dashboard-hero-financial__perf-cell">
                <MetricLabel label={metric.label} icon={metric.icon} />
                <div
                  className={cn(
                    "dashboard-hero-financial__value dashboard-hero-financial__value--support",
                    metric.valueClassName,
                  )}
                >
                  {metric.value}
                </div>
                {metric.hint ? (
                  <p className="dashboard-hero-financial__hint">{metric.hint}</p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {analyticsHref && analyticsLabel ? (
        <Link
          to={analyticsHref}
          className={cn(
            "dashboard-hero-financial__analytics-link",
            loading && "dashboard-hero-financial__analytics-link--reserved",
          )}
        >
          {analyticsLabel}
        </Link>
      ) : null}
    </section>
  );
}

function MetricLabel({ label, icon }: { label: string; icon?: ReactNode }) {
  return (
    <p className="dashboard-hero-financial__label">
      {icon ? (
        <span className="dashboard-hero-financial__metric-icon" aria-hidden>
          {icon}
        </span>
      ) : null}
      <span className="dashboard-hero-financial__label-text">{label}</span>
    </p>
  );
}
