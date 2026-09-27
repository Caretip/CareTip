import { lazy, Suspense, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ArrowRight, Sparkles } from "lucide-react";
import { CountUpMetric } from "../dashboard/CountUpMetric";
import { businessUi } from "./businessDashboardUi";
import { cn } from "@/lib/utils";
import type { useBusinessIntelligenceData } from "../../hooks/useBusinessIntelligenceData";
import type { ExecutiveInsight, ExecutiveOpportunity } from "../../lib/businessIntelligence";

const ExecutiveHealthTrends = lazy(() =>
  import("./insights/ExecutiveHealthTrends").then((mod) => ({
    default: mod.ExecutiveHealthTrends,
  })),
);

type BiData = ReturnType<typeof useBusinessIntelligenceData>;

function CompactInsightRows({
  items,
  icon: Icon,
  iconClass,
  titleId,
  title,
  emptyMessageKey,
}: {
  items: ExecutiveOpportunity[];
  icon: typeof AlertTriangle;
  iconClass: string;
  titleId: string;
  title: string;
  emptyMessageKey?: string;
}) {
  const { t } = useTranslation();
  if (items.length === 0) {
    if (!emptyMessageKey) return null;
    return (
      <section aria-labelledby={titleId}>
        <h2 id={titleId} className="business-performance-section-label">{title}</h2>
        <p className="text-sm text-muted-foreground">{t(emptyMessageKey)}</p>
      </section>
    );
  }
  return (
    <section aria-labelledby={titleId}>
      <h2 id={titleId} className="business-performance-section-label">{title}</h2>
      <ul className="business-performance-insight-list">
        {items.map((item) => (
          <li key={item.id} className="business-performance-insight-row">
            <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", iconClass)} aria-hidden />
            <div className="min-w-0">
              <p className="business-performance-insight-row__title">{t(item.messageKey, item.params)}</p>
              <p className="business-performance-insight-row__detail">{t(item.evidenceKey, item.evidenceParams)}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ExecutiveSummaryStrip({ data }: { data: BiData }) {
  const { t } = useTranslation();
  const summary = data.bi.executiveSummary;
  const snap = data.bi.snapshot;
  const growth = data.bi.revenue.growthComparable ? snap.growthRate : null;

  const collectingKey = "business.team.performance.executive.summary.collectingData";
  const firstClause = summary.clauses[0];
  const interpretation =
    firstClause && firstClause.key !== collectingKey
      ? String(t(firstClause.key, firstClause.params))
      : firstClause
        ? String(t(firstClause.key, firstClause.params))
        : null;

  return (
    <section aria-labelledby="exec-summary-heading">
      <h2 id="exec-summary-heading" className="business-performance-section-label">
        {t("business.team.performance.executive.summaryTitle")}
      </h2>
      <div className="business-performance-metric-grid">
        <div className="business-performance-metric">
          <p className="business-performance-metric__label">
            {t("business.team.performance.executive.snapshot.growth")}
          </p>
          <p className="business-performance-metric__value">
            {growth != null ? <CountUpMetric value={growth} kind="percent" /> : "—"}
          </p>
          {growth != null ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("business.team.performance.executive.growthComparisonHint")}
            </p>
          ) : null}
        </div>
        <div className="business-performance-metric">
          <p className="business-performance-metric__label">
            {t("business.team.performance.executive.snapshot.participation")}
          </p>
          <p className="business-performance-metric__value">
            <CountUpMetric value={snap.employeeParticipation} kind="integer" />%
          </p>
        </div>
        <div className="business-performance-metric">
          <p className="business-performance-metric__label">
            {t("business.team.performance.executive.snapshot.goalCompletion")}
          </p>
          <p className="business-performance-metric__value">
            <CountUpMetric value={snap.goalCompletion} kind="integer" />%
          </p>
        </div>
        <div className="business-performance-metric">
          <p className="business-performance-metric__label">
            {t("business.tips.analytics.cards.totalTips")}
          </p>
          <p className="business-performance-metric__value">
            <CountUpMetric value={snap.periodTipCount} kind="integer" />
          </p>
        </div>
      </div>
      {interpretation ? <p className="business-performance-summary-line">{interpretation}</p> : null}
    </section>
  );
}

function BusinessHealthStrip({ data }: { data: BiData }) {
  const { t } = useTranslation();
  const { score } = data.bi.health;
  const fillPct = Math.min(100, Math.max(0, score));

  return (
    <section aria-labelledby="exec-health-heading">
      <h2 id="exec-health-heading" className="business-performance-section-label">
        {t("business.team.performance.executive.healthTitle")}
      </h2>
      <div className="business-performance-metric-grid">
        <div className="business-performance-metric sm:col-span-2">
          <p className="business-performance-metric__label">
            {t("business.team.performance.executive.snapshot.health")}
          </p>
          <p className="business-performance-metric__value">
            <CountUpMetric value={score} kind="integer" />
            <span className="text-base font-medium text-muted-foreground"> / 100</span>
          </p>
          <div
            className="business-performance-health-bar"
            role="progressbar"
            aria-valuenow={score}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t("business.team.performance.executive.snapshot.health")}
          >
            <div className="business-performance-health-bar__fill" style={{ width: `${fillPct}%` }} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("business.team.performance.executive.healthIndexHint")}
          </p>
        </div>
      </div>
      <p className="sr-only">{t("business.team.performance.executive.healthExplain")}</p>
    </section>
  );
}

function KeyInsightsStrip({ data }: { data: BiData }) {
  const { t } = useTranslation();
  const insights = data.bi.insights;
  const peak = insights.peakPeriod !== "—" ? insights.peakPeriod : null;

  if (!peak) return null;

  return (
    <section aria-labelledby="exec-key-insights">
      <h2 id="exec-key-insights" className="business-performance-section-label">
        {t("business.team.performance.executive.insightsTitle")}
      </h2>
      <div className="business-performance-key-insights">
        <div className="business-performance-key-insight">
          <p className="business-performance-key-insight__value">{peak}</p>
          <p className="business-performance-key-insight__label">{t("business.team.performance.bi.peakPeriod")}</p>
        </div>
      </div>
    </section>
  );
}

function ExecutiveInsightLines({ insights }: { insights: BiData["bi"]["executiveInsights"] }) {
  const { t } = useTranslation();
  if (insights.length === 0) return null;
  return (
    <ul className="business-performance-insight-list">
      {insights.map((item: ExecutiveInsight) => (
        <li key={item.id} className="business-performance-insight-row">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <p className="business-performance-insight-row__title">{String(t(item.messageKey, item.params))}</p>
        </li>
      ))}
    </ul>
  );
}

type BusinessExecutivePerformanceProps = {
  data: BiData;
};

/** Sprint 6G — Performance owns intelligence; reporting stays in Analytics. */
export function BusinessExecutivePerformance({ data }: BusinessExecutivePerformanceProps) {
  const { t } = useTranslation();
  const tipVolumeTrend = useMemo(
    () => data.bi.trends.tipVolumeTrend,
    [data.bi.trends.tipVolumeTrend],
  );
  const showTrendsSection = data.bi.executiveInsights.length > 0;

  return (
    <div className="business-performance-workspace caretip-mobile-performance-report">
      <ExecutiveSummaryStrip data={data} />
      <BusinessHealthStrip data={data} />

      <section className="business-performance-chart-panel" aria-labelledby="exec-health-trends">
        <h2 id="exec-health-trends" className="business-performance-section-label">
          {t("business.team.performance.executive.tipVolumeTrendTitle")}
        </h2>
        <Suspense
          fallback={
            <div className={cn(businessUi.cardStatic, "h-[240px] animate-pulse bg-muted/20")} />
          }
        >
          <ExecutiveHealthTrends tipVolume={tipVolumeTrend} loading={data.loading} />
        </Suspense>
      </section>

      <KeyInsightsStrip data={data} />

      <CompactInsightRows
        titleId="exec-risks"
        title={t("business.team.performance.executive.risksTitle")}
        items={data.bi.risks}
        icon={AlertTriangle}
        iconClass="text-amber-700 dark:text-amber-400"
        emptyMessageKey="business.team.performance.executive.risksEmpty"
      />
      <CompactInsightRows
        titleId="exec-recommendations"
        title={t("business.team.performance.executive.recommendationsTitle")}
        items={data.bi.recommendations}
        icon={ArrowRight}
        iconClass="text-muted-foreground"
        emptyMessageKey="business.team.performance.executive.recommendationsEmpty"
      />

      {showTrendsSection ? (
        <section aria-labelledby="exec-more-insights">
          <h2 id="exec-more-insights" className="business-performance-section-label">
            {t("business.team.performance.executive.trendsTitle")}
          </h2>
          <ExecutiveInsightLines insights={data.bi.executiveInsights} />
        </section>
      ) : null}
    </div>
  );
}
