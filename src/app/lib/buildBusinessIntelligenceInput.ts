import type { BusinessDashboardStats, BusinessQrAnalytics, TipActivityRow } from "./api";
import type { AnalyticsPeriodSnapshot } from "../lib/businessAnalytics/types";
import type { AnalyticsTimeframe } from "../lib/businessAnalytics/types";
import {
  resolveBusinessTimezone,
  venueLocalCalendarYear,
  venueLocalTodayKey,
} from "./businessVenueTime";

/**
 * Sprint 2D — shared BI input builder (Pipeline B convergence).
 * Maps GET /api/business/me/stats + recent tips into BusinessIntelligenceInput.
 * Registry: docs/KPI_SOURCE_OF_TRUTH.md
 */
export type BuildBiInputParams = {
  period: AnalyticsPeriodSnapshot;
  week: AnalyticsPeriodSnapshot;
  today: AnalyticsPeriodSnapshot;
  dailyTipDistribution: NonNullable<BusinessDashboardStats["dailyTipDistribution"]>;
  recentTips: TipActivityRow[];
  employees: NonNullable<BusinessDashboardStats["employees"]>;
  employeeGoals: NonNullable<BusinessDashboardStats["employeeGoals"]>;
  pulse: BusinessDashboardStats["operationalPulse"] | null;
  qrAnalytics?: BusinessQrAnalytics | null;
  locationRankings?: BusinessDashboardStats["locationRankings"];
  tableRankings?: BusinessDashboardStats["tableRankings"];
  growthPercent?: number | null;
  peakHour?: number | null;
  bestShift?: BusinessDashboardStats["bestShift"];
  avgTipsPerShift?: number | null;
  completedShifts?: number | null;
};

/** Build BI input from period-scoped stats — timeframe-agnostic field names (Sprint 3D). */
export function buildBusinessIntelligenceInput(params: BuildBiInputParams) {
  return {
    period: params.period,
    week: params.week,
    today: params.today,
    dailyTipDistribution: params.dailyTipDistribution,
    recentTips: params.recentTips,
    employees: params.employees,
    employeeGoals: params.employeeGoals,
    pulse: params.pulse,
    qrAnalytics: params.qrAnalytics ?? null,
    locationRankings: params.locationRankings ?? [],
    tableRankings: params.tableRankings ?? [],
    growthPercent: params.growthPercent ?? null,
    peakHour: params.peakHour ?? null,
    bestShift: params.bestShift ?? null,
    avgTipsPerShift: params.avgTipsPerShift ?? null,
    completedShifts: params.completedShifts ?? null,
  };
}

/** Tips feed query for analytics period — DB-backed via GET /api/tips/business. */
export function tipsFeedParamsForTimeframe(timeframe: AnalyticsTimeframe): {
  take: number;
  range?: "week" | "month" | "custom";
  fromDate?: string;
  toDate?: string;
} {
  if (timeframe === "year") {
    // Venue calendar year — never browser getFullYear / UTC date slice.
    const tz = resolveBusinessTimezone();
    const year = venueLocalCalendarYear(tz);
    const today = venueLocalTodayKey(tz);
    return {
      take: 200,
      range: "custom",
      fromDate: `${year}-01-01`,
      toDate: today,
    };
  }
  if (timeframe === "week") {
    return { take: 100, range: "week" };
  }
  return { take: 100, range: "month" };
}
