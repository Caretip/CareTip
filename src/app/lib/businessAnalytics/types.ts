import type { BusinessDashboardStats, TipActivityRow, BusinessStatsScope } from "../api";
import type { BusinessIntelligenceInput } from "../businessIntelligence";
import type { BusinessIntelligenceAggregate } from "../businessIntelligenceEngine";

export type { BusinessIntelligenceAggregate } from "../businessIntelligenceEngine";
/** Shared timeframe for all business analytics surfaces. */
export type AnalyticsTimeframe = "week" | "month" | "year";

export type AnalyticsPeriodSnapshot = {
  totalTips: number;
  tipCount: number;
  averageTip: number;
};

/** Raw network payload before DTO assembly. */
export type BusinessAnalyticsBundle = {
  timeframe: AnalyticsTimeframe;
  periodStats: BusinessDashboardStats;
  weekStats: BusinessDashboardStats;
  recentTips: TipActivityRow[];
  qrAnalytics?: import("../api").BusinessQrAnalytics | null;
  fetchedAt: number;
  /** True after tips feed was fetched for this bundle (stats-only cache writes leave false). */
  tipsFeedFetched?: boolean;
  /** True after QR analytics was requested for this bundle. */
  qrFetched?: boolean;
  /** True after scope=aboveFold period stats landed (overview/revenue/ops gate). */
  aboveFoldFetched?: boolean;
  /** True after scope=analytics deferred slice landed (charts/rankings/shifts/goals). */
  deferredAnalyticsFetched?: boolean;
};

/**
 * Authoritative analytics contract for business manager dashboards.
 * Registry: docs/KPI_SOURCE_OF_TRUTH.md · Sprint 3 unified model.
 */
export type BusinessAnalyticsDTO = {
  timeframe: AnalyticsTimeframe;
  /** Full period stats from GET /api/business/me/stats?scope=full */
  stats: BusinessDashboardStats;
  period: AnalyticsPeriodSnapshot;
  week: AnalyticsPeriodSnapshot;
  today: AnalyticsPeriodSnapshot;
  pulse: BusinessDashboardStats["operationalPulse"] | null;
  recentTips: TipActivityRow[];
  employees: NonNullable<BusinessDashboardStats["employees"]>;
  employeeGoals: NonNullable<BusinessDashboardStats["employeeGoals"]>;
  dailyTipDistribution: NonNullable<BusinessDashboardStats["dailyTipDistribution"]>;
  input: BusinessIntelligenceInput;
  intelligence: BusinessIntelligenceAggregate;
  fetchedAt: number;
};

export type FetchBusinessAnalyticsOptions = {
  signal?: AbortSignal;
  silent?: boolean;
  revalidate?: boolean;
  /** Stats API scope — use `summary` for Starter tier dashboards. */
  scope?: BusinessStatsScope;
  /** When false, skips tips feed fetch (Overview KPI-only refresh). */
  includeTipsFeed?: boolean;
  /** When false, skips week comparison stats fetch. */
  includeWeekStats?: boolean;
  /** When false, skips QR analytics fetch. */
  includeQrAnalytics?: boolean;
  /** When false, skips deferred scope=analytics (charts, rankings, shifts, goals). */
  includeDeferredAnalytics?: boolean;
  /** Called as each bundle slice lands so UI can render progressively. */
  onProgress?: (bundle: BusinessAnalyticsBundle) => void;
};
