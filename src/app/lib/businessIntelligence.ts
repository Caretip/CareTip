import type { BusinessDashboardStats, BusinessQrAnalytics, TipActivityRow } from "./api";
import type { AnalyticsPeriodSnapshot } from "./businessAnalytics/types";
import { resolveBusinessTimezone, venueLocalHour } from "./businessVenueTime";
import { comparableGrowthPercent } from "./businessAnalytics/analyticsPeriodMetrics";

/**
 * Business intelligence aggregates — Sprint 6: traceable KPIs from tips, employees,
 * goals, pulse, and QR analytics (Sprint 4). Registry: docs/KPI_SOURCE_OF_TRUTH.md
 */

export type BusinessIntelligenceInput = {
  period: AnalyticsPeriodSnapshot;
  week: AnalyticsPeriodSnapshot;
  today: AnalyticsPeriodSnapshot;
  dailyTipDistribution: Array<{ day: string; amount: number }>;
  recentTips: TipActivityRow[];
  employees: NonNullable<BusinessDashboardStats["employees"]>;
  employeeGoals: NonNullable<BusinessDashboardStats["employeeGoals"]>;
  pulse: BusinessDashboardStats["operationalPulse"] | null;
  /** Sprint 6 — optional QR analytics from GET /api/business/qr-analytics */
  qrAnalytics?: BusinessQrAnalytics | null;
  /** SQL rankings for selected timeframe (authoritative). */
  locationRankings?: Array<{ id: string | null; name: string; tipsEur: number; tipCount: number }>;
  tableRankings?: Array<{ id: string | null; name: string; tipsEur: number; tipCount: number }>;
  /** Server growth % vs prior equal window; null when unavailable or not comparable. */
  growthPercent?: number | null;
  /** Prior equal-length window totals from SQL (authoritative for growth). */
  priorPeriod?: { totalTips: number; tipCount: number } | null;
  peakHour?: number | null;
  bestShift?: "morning" | "afternoon" | "evening" | "late" | null;
  avgTipsPerShift?: number | null;
  completedShifts?: number | null;
};

export type IntelligenceSeverity = "low" | "medium" | "high";

/** Traceability — every intelligence item cites source KPI and calculation. */
export type IntelligenceTrace = {
  sourceKpi: string;
  calculationPath: string;
  evidenceKey: string;
  evidenceParams?: Record<string, string | number>;
  severity?: IntelligenceSeverity;
};
export type RevenueAnalytics = {
  totalTips: number;
  tipCount: number;
  growthPercent: number;
  /** False when prior-period volume is zero — do not present growthPercent as a real rate. */
  growthComparable: boolean;
  averageTip: number;
  dailyRevenue: number;
  weeklyRevenue: number;
  periodRevenue: number;
};

export type BusinessInsights = {
  bestDay: string;
  bestDayAmount: number;
  bestShift: string;
  bestLocation: string;
  bestTable: string;
  peakPeriod: string;
};

export type OperationalMetrics = {
  activeEmployees: number;
  employeesReceivingTips: number;
  averageTipsPerEmployee: number;
  /** Null until real shift configuration exists — never fabricate ÷3. */
  averageTipsPerShift: number | null;
};

function shiftLabel(hour: number): string {
  if (hour >= 6 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "late";
}

function aggregateByKey(
  tips: TipActivityRow[],
  key: "locationName" | "tableName",
): { label: string; count: number; amount: number } | null {
  const map = new Map<string, { count: number; amount: number }>();
  for (const tip of tips) {
    const raw = tip[key];
    const label = raw?.trim() || "Main venue";
    const row = map.get(label) ?? { count: 0, amount: 0 };
    row.count += 1;
    row.amount += tip.amount;
    map.set(label, row);
  }
  let best: { label: string; count: number; amount: number } | null = null;
  for (const [label, stats] of map) {
    if (!best || stats.amount > best.amount) best = { label, ...stats };
  }
  return best;
}

/**
 * Source: `tips` via GET /api/business/me/stats (week/month/year scopes).
 * Calculation: period sums; growthPercent from SQL prior-window comparison when present.
 * Refresh: useBusinessAnalytics — socket `new_tip` / `business_data_updated` + 45s poll fallback.
 */
export function computeRevenueAnalytics(input: BusinessIntelligenceInput): RevenueAnalytics {
  const { period, week, today, dailyTipDistribution } = input;
  const priorTotal = input.priorPeriod?.totalTips;
  const fromPrior =
    typeof priorTotal === "number"
      ? comparableGrowthPercent(period.totalTips, priorTotal)
      : null;
  const growthComparable = fromPrior !== null;
  const growthPercent = growthComparable
    ? fromPrior
    : 0;

  const lastDayAmount =
    dailyTipDistribution.length > 0
      ? dailyTipDistribution[dailyTipDistribution.length - 1]?.amount ?? 0
      : today.totalTips;

  return {
    totalTips: period.totalTips,
    tipCount: period.tipCount,
    growthPercent,
    growthComparable,
    averageTip: period.averageTip,
    dailyRevenue: lastDayAmount || today.totalTips,
    weeklyRevenue: week.totalTips,
    periodRevenue: period.totalTips,
  };
}

/**
 * Source: `tips` + `dailyTipDistribution` + SQL location/table/shift aggregates from business stats.
 * Refresh: same as revenue analytics.
 */
export function computeBusinessInsights(input: BusinessIntelligenceInput): BusinessInsights {
  const { dailyTipDistribution, recentTips, locationRankings, tableRankings } = input;

  let bestDay = "—";
  let bestDayAmount = 0;
  for (const row of dailyTipDistribution) {
    if (row.amount > bestDayAmount) {
      bestDayAmount = row.amount;
      bestDay = row.day;
    }
  }

  let bestShift = "—";
  if (input.bestShift != null) {
    bestShift = input.bestShift || "—";
  } else {
    const shiftCounts: Record<string, number> = { morning: 0, afternoon: 0, evening: 0, late: 0 };
    for (const tip of recentTips) {
      const h = venueLocalHour(tip.createdAt, resolveBusinessTimezone());
      if (!Number.isNaN(h)) shiftCounts[shiftLabel(h)] += tip.amount;
    }
    let bestShiftAmount = 0;
    for (const [shift, amount] of Object.entries(shiftCounts)) {
      if (amount > bestShiftAmount) {
        bestShiftAmount = amount;
        bestShift = shift;
      }
    }
  }

  const topLocation = locationRankings?.[0];
  const topTable = tableRankings?.[0];
  // When SQL rankings are present (including empty), never fall back to feed samples.
  const bestLocation =
    locationRankings != null
      ? topLocation && topLocation.tipsEur > 0
        ? topLocation.name
        : "—"
      : aggregateByKey(recentTips, "locationName")?.label ?? "—";
  const bestTable =
    tableRankings != null
      ? topTable && topTable.tipsEur > 0
        ? topTable.name
        : "—"
      : aggregateByKey(recentTips, "tableName")?.label ?? "—";

  let peakPeriod = "—";
  if (input.peakHour !== undefined && input.peakHour !== null) {
    const h = input.peakHour;
    if (h >= 0 && h < 24) {
      peakPeriod = `${String(h).padStart(2, "0")}:00–${String((h + 1) % 24).padStart(2, "0")}:00`;
    }
  } else {
    const hourBuckets = new Array(24).fill(0) as number[];
    for (const tip of recentTips) {
      const h = venueLocalHour(tip.createdAt, resolveBusinessTimezone());
      if (!Number.isNaN(h)) hourBuckets[h] += 1;
    }
    let peakHour = 0;
    let peakCount = 0;
    hourBuckets.forEach((c, h) => {
      if (c > peakCount) {
        peakCount = c;
        peakHour = h;
      }
    });
    peakPeriod =
      peakCount > 0
        ? `${String(peakHour).padStart(2, "0")}:00–${String((peakHour + 1) % 24).padStart(2, "0")}:00`
        : "—";
  }

  return { bestDay, bestDayAmount, bestShift, bestLocation, bestTable, peakPeriod };
}

/**
 * Source: `employees` + `tips` rollups from GET /api/business/me/stats; roster from operationalPulse.
 * `averageTipsPerShift` = SQL periodTips ÷ completed (day×shift) buckets when present; else null.
 */
export function computeOperationalMetrics(input: BusinessIntelligenceInput): OperationalMetrics {
  const { employees, period, pulse } = input;
  const activeEmployees =
    pulse?.tippingReadyEmployees ??
    pulse?.rosterTotal ??
    employees.filter((e) => e.isActive !== false).length;
  const employeesReceivingTips = employees.filter((e) => e.tipCount > 0).length;
  const averageTipsPerEmployee =
    employeesReceivingTips > 0 ? period.totalTips / employeesReceivingTips : 0;

  const avgFromServer =
    typeof input.avgTipsPerShift === "number" &&
    Number.isFinite(input.avgTipsPerShift) &&
    (input.completedShifts ?? 0) > 0
      ? input.avgTipsPerShift
      : null;

  return {
    activeEmployees,
    employeesReceivingTips,
    averageTipsPerEmployee,
    averageTipsPerShift: avgFromServer,
  };
}

/**
 * Source: `dailyTipDistribution` (tips € per bucket from DB).
 * Tip-count proxy per day derived from amount ÷ period average (tips table only).
 * Refresh: useBusinessTipsModuleData.
 */
export function buildTrendChartSeries(input: BusinessIntelligenceInput) {
  const { dailyTipDistribution, period } = input;

  const tipsOverTime = dailyTipDistribution.map((row) => {
    const tipCount =
      row.amount > 0 ? Math.max(1, Math.round(row.amount / (period.averageTip || 8))) : 0;
    return {
      label: row.day,
      tips: row.amount,
      tipCount,
    };
  });

  return {
    tipsOverTime: tipsOverTime.map(({ label, tips }) => ({ label, tips })),
    revenueTrend: tipsOverTime.map(({ label, tips }) => ({ label, revenue: tips })),
    /** Daily successful tip volume (€) — not employee participation %. */
    tipVolumeTrend: tipsOverTime.map(({ label, tips }) => ({
      label,
      tips,
    })),
  };
}

export type BusinessHealthGrade = "excellent" | "good" | "fair" | "needs_attention";

export type BusinessHealthScore = {
  score: number;
  grade: BusinessHealthGrade;
  components: {
    revenueGrowth: number;
    employeeParticipation: number;
    goalCompletion: number;
    activeEmployees: number;
    guestFeedback: number;
    tipActivity: number;
  };
};

const HEALTH_COMPONENT_MAX = 100 / 6;

function computeGoalCompletionScore(input: BusinessIntelligenceInput): number {
  const goals = input.employeeGoals;
  if (goals.length > 0) {
    const avgPercent = goals.reduce((sum, g) => sum + g.percent, 0) / goals.length;
    return Math.min(HEALTH_COMPONENT_MAX, (avgPercent / 100) * HEALTH_COMPONENT_MAX);
  }
  const { pulse } = input;
  if (pulse && pulse.goalsTracked > 0) {
    return Math.min(
      HEALTH_COMPONENT_MAX,
      (pulse.goalsOnTrackOrBetter / pulse.goalsTracked) * HEALTH_COMPONENT_MAX,
    );
  }
  return 0;
}

/**
 * Business health score — DB-backed only (Sprint 1).
 * Sources: tips (growth, activity), employees (participation, ratings), employee_goals / pulse.
 * No QR-derived inputs. Refresh: useBusinessTipsModuleData.
 */
export function computeBusinessHealthScore(input: BusinessIntelligenceInput): BusinessHealthScore {
  const revenue = computeRevenueAnalytics(input);
  const ops = computeOperationalMetrics(input);
  const { period } = input;
  const growthForHealth = revenue.growthComparable ? revenue.growthPercent : 0;

  const revenueGrowth = Math.min(
    HEALTH_COMPONENT_MAX,
    Math.max(0, HEALTH_COMPONENT_MAX / 2 + (growthForHealth / 100) * (HEALTH_COMPONENT_MAX / 2)),
  );

  const participationRatio =
    ops.activeEmployees > 0 ? ops.employeesReceivingTips / ops.activeEmployees : 0;
  const employeeParticipation = Math.min(HEALTH_COMPONENT_MAX, participationRatio * HEALTH_COMPONENT_MAX);

  const goalCompletion = computeGoalCompletionScore(input);

  const activeEmployees =
    ops.activeEmployees > 0
      ? Math.min(
          HEALTH_COMPONENT_MAX,
          (HEALTH_COMPONENT_MAX / 2) *
            (1 + Math.min(1, ops.activeEmployees / 10) * 0.5 + (period.tipCount > 0 ? 0.5 : 0)),
        )
      : 0;

  const rated = input.employees.filter((e) => e.rating != null && e.rating > 0);
  const guestFeedback =
    rated.length > 0
      ? Math.min(
          HEALTH_COMPONENT_MAX,
          (rated.reduce((s, e) => s + (e.rating ?? 0), 0) / rated.length / 5) * HEALTH_COMPONENT_MAX,
        )
      : 0;

  const tipActivity =
    period.tipCount > 0
      ? Math.min(
          HEALTH_COMPONENT_MAX,
          (HEALTH_COMPONENT_MAX / 3) * 2 +
            Math.min(1, period.tipCount / 50) * (HEALTH_COMPONENT_MAX / 3),
        )
      : 0;

  const score = Math.round(
    revenueGrowth +
      employeeParticipation +
      goalCompletion +
      activeEmployees +
      guestFeedback +
      tipActivity,
  );
  const grade: BusinessHealthGrade =
    score >= 85 ? "excellent" : score >= 70 ? "good" : score >= 50 ? "fair" : "needs_attention";

  return {
    score,
    grade,
    components: {
      revenueGrowth,
      employeeParticipation,
      goalCompletion,
      activeEmployees,
      guestFeedback,
      tipActivity,
    },
  };
}

export type ExecutiveInsight = {
  id: string;
  messageKey: string;
  params?: Record<string, string | number>;
};

export type ExecutiveOpportunity = {
  id: string;
  messageKey: string;
  params?: Record<string, string | number>;
  tone: "info" | "warning" | "success";
} & IntelligenceTrace;

export type ExecutiveRisk = ExecutiveOpportunity;
export type ExecutiveRecommendation = ExecutiveOpportunity;

export type ExecutiveSummary = {
  messageKey: string;
  params?: Record<string, string | number>;
  /** Factual clauses assembled from detected signals — no AI. */
  clauses: Array<{ key: string; params?: Record<string, string | number> }>;
};
export function generateExecutiveInsights(input: BusinessIntelligenceInput): ExecutiveInsight[] {
  const insights = computeBusinessInsights(input);
  const out: ExecutiveInsight[] = [];

  if (insights.peakPeriod !== "—") {
    out.push({
      id: "peak-period",
      messageKey: "business.team.performance.executive.insights.peakPeriod",
      params: { period: insights.peakPeriod },
    });
  }

  return out.slice(0, 1);
}

function trace(
  sourceKpi: string,
  calculationPath: string,
  evidenceKey: string,
  evidenceParams?: Record<string, string | number>,
  severity?: IntelligenceSeverity,
): IntelligenceTrace {
  return { sourceKpi, calculationPath, evidenceKey, evidenceParams, severity };
}

/**
 * Trusted risk signals — Sprint 6: severity, evidence, explainable calculation path.
 */
export function generateExecutiveRisks(input: BusinessIntelligenceInput): ExecutiveRisk[] {
  const revenue = computeRevenueAnalytics(input);
  const ops = computeOperationalMetrics(input);
  const out: ExecutiveRisk[] = [];

  if (revenue.tipCount === 0 && ops.activeEmployees > 0) {
    out.push({
      id: "no-tip-activity",
      messageKey: "business.team.performance.executive.risks.noTipActivity",
      tone: "warning",
      ...trace(
        "tipCount",
        "period.tipCount === 0 && activeEmployees > 0",
        "business.team.performance.executive.evidence.noTipActivity",
        { active: ops.activeEmployees },
        "high",
      ),
    });
  }

  return out.slice(0, 2);
}

/** Evidence-backed recommendations only — no generic playbooks. */
export function generateExecutiveRecommendations(
  _input: BusinessIntelligenceInput,
  _risks: ExecutiveRisk[],
  _opportunities: ExecutiveOpportunity[],
): ExecutiveRecommendation[] {
  return [];
}

export function generateOpportunities(_input: BusinessIntelligenceInput): ExecutiveOpportunity[] {
  return [];
}

/** Factual executive summary — rule-assembled clauses, no AI wording. */
export function generateExecutiveSummary(
  _input: BusinessIntelligenceInput,
  ctx: {
    revenue: RevenueAnalytics;
    snapshot: PerformanceSnapshot;
    risks: ExecutiveRisk[];
    opportunities: ExecutiveOpportunity[];
    qrAnalytics: BusinessQrAnalytics | null;
  },
): ExecutiveSummary {
  const clauses: ExecutiveSummary["clauses"] = [];

  if (ctx.risks.some((r) => r.id === "no-tip-activity")) {
    clauses.push({ key: "business.team.performance.executive.summary.noTipActivity" });
  } else if (ctx.revenue.growthComparable && ctx.revenue.growthPercent > 5) {
    clauses.push({
      key: "business.team.performance.executive.summary.revenueHealthy",
      params: { percent: ctx.revenue.growthPercent },
    });
  } else if (ctx.revenue.growthComparable && ctx.revenue.growthPercent < -5) {
    clauses.push({
      key: "business.team.performance.executive.summary.revenueDeclining",
      params: { percent: Math.abs(ctx.revenue.growthPercent) },
    });
  } else if (ctx.revenue.tipCount > 0) {
    clauses.push({ key: "business.team.performance.executive.summary.revenueStable" });
  } else {
    clauses.push({ key: "business.team.performance.executive.summary.collectingData" });
  }

  return {
    messageKey: "business.team.performance.executive.summary.composite",
    params: { clauseCount: clauses.length },
    clauses: clauses.slice(0, 1),
  };
}

export type PerformanceSnapshot = {
  healthScore: number;
  growthRate: number;
  employeeParticipation: number;
  goalCompletion: number;
  guestSatisfaction: number;
  activeLocations: number;
  periodTipCount: number;
};

/**
 * Source: trusted BI aggregates (tips, employees, goals, SQL location rankings).
 * Refresh: useBusinessTipsModuleData.
 */
export function computePerformanceSnapshot(input: BusinessIntelligenceInput): PerformanceSnapshot {
  const health = computeBusinessHealthScore(input);
  const revenue = computeRevenueAnalytics(input);
  const ops = computeOperationalMetrics(input);
  const rated = input.employees.filter((e) => e.rating != null && e.rating > 0);
  const satisfaction =
    rated.length > 0 ? rated.reduce((s, e) => s + (e.rating ?? 0), 0) / rated.length : 0;
  const activeLocations =
    (input.locationRankings?.filter((r) => r.tipsEur > 0).length ?? 0) ||
    new Set(input.recentTips.map((t) => t.locationName?.trim() || "Main venue")).size;

  const goals = input.employeeGoals;
  let goalCompletion = 0;
  if (goals.length > 0) {
    goalCompletion = Math.round(goals.reduce((s, g) => s + g.percent, 0) / goals.length);
  } else if (input.pulse && input.pulse.goalsTracked > 0) {
    goalCompletion = Math.round((input.pulse.goalsOnTrackOrBetter / input.pulse.goalsTracked) * 100);
  }

  return {
    healthScore: health.score,
    growthRate: revenue.growthPercent,
    employeeParticipation:
      ops.activeEmployees > 0
        ? Math.round((ops.employeesReceivingTips / ops.activeEmployees) * 100)
        : 0,
    goalCompletion,
    guestSatisfaction: satisfaction,
    activeLocations,
    periodTipCount: input.period.tipCount,
  };
}

export type ComparisonRow = { label: string; tips: number; count: number; share: number };

function buildComparisons(
  tips: TipActivityRow[],
  key: "locationName" | "tableName",
  fallback: string,
): ComparisonRow[] {
  const map = new Map<string, { tips: number; count: number }>();
  let total = 0;
  for (const tip of tips) {
    const label = tip[key]?.trim() || fallback;
    const row = map.get(label) ?? { tips: 0, count: 0 };
    row.tips += tip.amount;
    row.count += 1;
    total += tip.amount;
    map.set(label, row);
  }
  return [...map.entries()]
    .map(([label, stats]) => ({
      label,
      tips: stats.tips,
      count: stats.count,
      share: total > 0 ? Math.round((stats.tips / total) * 100) : 0,
    }))
    .sort((a, b) => b.tips - a.tips);
}

export function computeLocationComparisons(input: BusinessIntelligenceInput): ComparisonRow[] {
  const rankings = input.locationRankings;
  if (rankings != null) {
    const total = rankings.reduce((s, r) => s + r.tipsEur, 0);
    return rankings.map((r) => ({
      label: r.name,
      tips: r.tipsEur,
      count: r.tipCount,
      share: total > 0 ? Math.round((r.tipsEur / total) * 100) : 0,
    }));
  }
  return buildComparisons(input.recentTips, "locationName", "Main venue");
}

export function computeTableComparisons(input: BusinessIntelligenceInput): ComparisonRow[] {
  const rankings = input.tableRankings;
  if (rankings != null) {
    const total = rankings.reduce((s, r) => s + r.tipsEur, 0);
    return rankings
      .map((r) => ({
        label: r.name,
        tips: r.tipsEur,
        count: r.tipCount,
        share: total > 0 ? Math.round((r.tipsEur / total) * 100) : 0,
      }))
      .filter((r) => r.label !== "—");
  }
  return buildComparisons(input.recentTips, "tableName", "—").filter((r) => r.label !== "—");
}

/** Top tip sources from recent successful tips (DB). Not QR scan data. */
export type TopTipSourceRow = { label: string; tipCount: number; tips: number };

export function computeTopTipSources(input: BusinessIntelligenceInput): TopTipSourceRow[] {
  const map = new Map<string, { tips: number; count: number }>();
  for (const tip of input.recentTips) {
    const label = tip.staffName?.trim() || tip.locationName?.trim() || "Venue QR";
    const row = map.get(label) ?? { tips: 0, count: 0 };
    row.tips += tip.amount;
    row.count += 1;
    map.set(label, row);
  }
  return [...map.entries()]
    .map(([label, stats]) => ({
      label,
      tips: stats.tips,
      tipCount: stats.count,
    }))
    .sort((a, b) => b.tips - a.tips)
    .slice(0, 8);
}

/** Base compute pass — risks/opps/recs/summary added by BusinessIntelligenceEngine. */
export function aggregateBusinessIntelligenceLegacyCompute(input: BusinessIntelligenceInput) {
  return {
    revenue: computeRevenueAnalytics(input),
    insights: computeBusinessInsights(input),
    operational: computeOperationalMetrics(input),
    trends: buildTrendChartSeries(input),
    health: computeBusinessHealthScore(input),
    executiveInsights: [] as ExecutiveInsight[],
    opportunities: [] as ExecutiveOpportunity[],
    risks: [] as ExecutiveRisk[],
    recommendations: [] as ExecutiveRecommendation[],
    executiveSummary: {
      messageKey: "business.team.performance.executive.summary.collectingData",
      clauses: [{ key: "business.team.performance.executive.summary.collectingData" }],
    } as ExecutiveSummary,
    snapshot: computePerformanceSnapshot(input),
    locations: computeLocationComparisons(input),
    tables: computeTableComparisons(input),
    topTipSources: computeTopTipSources(input),
  };
}
