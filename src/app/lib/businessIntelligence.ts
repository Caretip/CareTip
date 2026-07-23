import type { BusinessDashboardStats, BusinessQrAnalytics, TipActivityRow } from "./api";
import type { AnalyticsPeriodSnapshot } from "./businessAnalytics/types";
import {
  resolveBusinessTimezone,
  venueLocalDayKey,
  venueLocalHour,
  venueLocalWeekDayKeys,
} from "./businessVenueTime";

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
  /** Server growth % vs prior equal window; null when unavailable. */
  growthPercent?: number | null;
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
  const growthPercent =
    typeof input.growthPercent === "number" && Number.isFinite(input.growthPercent)
      ? Math.round(input.growthPercent)
      : 0;

  const lastDayAmount =
    dailyTipDistribution.length > 0
      ? dailyTipDistribution[dailyTipDistribution.length - 1]?.amount ?? 0
      : today.totalTips;

  return {
    totalTips: period.totalTips,
    tipCount: period.tipCount,
    growthPercent,
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
    participationTrend: tipsOverTime.map(({ label, tipCount }) => ({
      label,
      participation: tipCount,
    })),
  };
}

/** QR scan + conversion trends from unified analytics bundle (`qrAnalytics` + tip distribution). */
export function buildQrChartSeries(input: BusinessIntelligenceInput) {
  const qr = input.qrAnalytics;
  const scansOverTime = (qr?.scanTrend ?? []).map((row) => ({
    label: row.label,
    scans: row.count,
  }));
  const hasScans = scansOverTime.some((row) => row.scans > 0);

  const tipsByLabel = new Map(input.dailyTipDistribution.map((row) => [row.day, row.amount]));
  const avgTip = input.period.averageTip || 8;

  const conversionTrend = scansOverTime.map((row) => {
    const tipsAmount = tipsByLabel.get(row.label) ?? 0;
    const tipCount = tipsAmount > 0 ? Math.max(1, Math.round(tipsAmount / avgTip)) : 0;
    const conversion = row.scans > 0 ? Math.round((tipCount / row.scans) * 1000) / 10 : 0;
    return { label: row.label, conversion };
  });
  const hasConversion = hasScans && conversionTrend.some((row) => row.conversion > 0);

  return { scansOverTime, conversionTrend, hasScans, hasConversion };
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

  const revenueGrowth = Math.min(
    HEALTH_COMPONENT_MAX,
    Math.max(0, HEALTH_COMPONENT_MAX / 2 + (revenue.growthPercent / 100) * (HEALTH_COMPONENT_MAX / 2)),
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
  const revenue = computeRevenueAnalytics(input);
  const insights = computeBusinessInsights(input);
  const out: ExecutiveInsight[] = [];

  if (revenue.growthPercent !== 0) {
    out.push({
      id: "tip-growth",
      messageKey: "business.team.performance.executive.insights.tipGrowth",
      params: { percent: Math.abs(revenue.growthPercent) },
    });
  }

  if (insights.peakPeriod !== "—") {
    out.push({
      id: "peak-period",
      messageKey: "business.team.performance.executive.insights.peakPeriod",
      params: { period: insights.peakPeriod },
    });
  }

  if (insights.bestTable !== "—") {
    const tableTips = aggregateByKey(input.recentTips, "tableName");
    const avgTable =
      input.recentTips.filter((t) => t.tableName).length > 0
        ? input.recentTips.reduce((s, t) => s + t.amount, 0) /
          input.recentTips.filter((t) => t.tableName).length
        : 0;
    const lift =
      tableTips && avgTable > 0
        ? Math.round(((tableTips.amount / tableTips.count - avgTable) / avgTable) * 100)
        : 0;
    if (lift > 0) {
      out.push({
        id: "table-lift",
        messageKey: "business.team.performance.executive.insights.tableLift",
        params: { table: insights.bestTable, percent: lift },
      });
    }
  }

  const periodParticipation = computePeriodParticipationPct(input);
  const weekParticipation = computeWeekParticipationPct(input);
  if (
    periodParticipation > 0 &&
    weekParticipation > 0 &&
    weekParticipation < periodParticipation - 8
  ) {
    out.push({
      id: "participation",
      messageKey: "business.team.performance.executive.insights.participationDecline",
      params: { from: periodParticipation, to: weekParticipation },
    });
  } else if (weekParticipation > periodParticipation + 8 && periodParticipation > 0) {
    out.push({
      id: "participation",
      messageKey: "business.team.performance.executive.insights.participationRise",
      params: { from: periodParticipation, to: weekParticipation },
    });
  }

  const qrMomentum = computeQrScanMomentum(input.qrAnalytics);
  if (qrMomentum != null && qrMomentum > 10) {
    out.push({
      id: "qr-momentum",
      messageKey: "business.team.performance.executive.insights.qrMomentum",
      params: { percent: qrMomentum },
    });
  }

  return out.slice(0, 4);
}

function computePeriodParticipationPct(input: BusinessIntelligenceInput): number {
  const ops = computeOperationalMetrics(input);
  return ops.activeEmployees > 0
    ? Math.round((ops.employeesReceivingTips / ops.activeEmployees) * 100)
    : 0;
}

/** Week participation from recentTips employee IDs — traceable to tips feed. */
function computeWeekParticipationPct(input: BusinessIntelligenceInput): number {
  const ops = computeOperationalMetrics(input);
  if (ops.activeEmployees <= 0) return 0;
  const tz = resolveBusinessTimezone();
  const weekKeys = new Set(venueLocalWeekDayKeys(tz));
  const weekTips = input.recentTips.filter((t) =>
    weekKeys.has(venueLocalDayKey(t.createdAt, tz)),
  );
  const uniqueEmployees = new Set(
    weekTips.map((t) => t.employeeId).filter((id): id is string => Boolean(id)),
  );
  return Math.round((uniqueEmployees.size / ops.activeEmployees) * 100);
}

function computeQrScanMomentum(qr: BusinessQrAnalytics | null | undefined): number | null {
  if (!qr?.scanTrend?.length || qr.scanTrend.length < 2) return null;
  const trend = qr.scanTrend;
  const mid = Math.floor(trend.length / 2);
  const firstHalf = trend.slice(0, mid).reduce((s, r) => s + r.count, 0);
  const secondHalf = trend.slice(mid).reduce((s, r) => s + r.count, 0);
  if (firstHalf === 0) return secondHalf > 0 ? 100 : 0;
  return Math.round(((secondHalf - firstHalf) / firstHalf) * 100);
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
  const snapshot = computePerformanceSnapshot(input);
  const periodParticipation = computePeriodParticipationPct(input);
  const weekParticipation = computeWeekParticipationPct(input);
  const qrMomentum = computeQrScanMomentum(input.qrAnalytics);
  const out: ExecutiveRisk[] = [];

  if (revenue.growthPercent < -5) {
    out.push({
      id: "tip-volume-decline",
      messageKey: "business.team.performance.executive.risks.tipVolumeDecline",
      params: { percent: Math.abs(revenue.growthPercent) },
      tone: "warning",
      ...trace(
        "revenueGrowthPercent",
        "(period.totalTips - priorPeriod.totalTips) / priorPeriod.totalTips * 100",
        "business.team.performance.executive.evidence.tipVolumeDecline",
        { weekTips: input.week.totalTips, periodTips: input.period.totalTips, percent: revenue.growthPercent },
        revenue.growthPercent < -15 ? "high" : "medium",
      ),
    });
  }

  if (periodParticipation > 0 && periodParticipation < 50) {
    out.push({
      id: "low-participation-risk",
      messageKey: "business.team.performance.executive.risks.lowParticipation",
      params: { percent: periodParticipation },
      tone: "warning",
      ...trace(
        "employeeParticipation",
        "employeesReceivingTips / activeEmployees * 100",
        "business.team.performance.executive.evidence.lowParticipation",
        {
          receiving: ops.employeesReceivingTips,
          active: ops.activeEmployees,
          percent: periodParticipation,
        },
        periodParticipation < 35 ? "high" : "medium",
      ),
    });
  }

  if (
    periodParticipation > 0 &&
    weekParticipation > 0 &&
    weekParticipation < periodParticipation - 8
  ) {
    out.push({
      id: "participation-decline",
      messageKey: "business.team.performance.executive.risks.participationDecline",
      params: { from: periodParticipation, to: weekParticipation },
      tone: "warning",
      ...trace(
        "employeeParticipation",
        "uniqueEmployeesInWeekTips / activeEmployees vs period rollup",
        "business.team.performance.executive.evidence.participationDecline",
        { from: periodParticipation, to: weekParticipation },
        "medium",
      ),
    });
  }

  if (snapshot.goalCompletion > 0 && snapshot.goalCompletion < 50) {
    out.push({
      id: "goal-completion-risk",
      messageKey: "business.team.performance.executive.risks.goalCompletionLow",
      params: { percent: snapshot.goalCompletion },
      tone: "warning",
      ...trace(
        "goalCompletion",
        "avg(employeeGoals.percent) or pulse.goalsOnTrackOrBetter / goalsTracked",
        "business.team.performance.executive.evidence.goalCompletionLow",
        { percent: snapshot.goalCompletion },
        snapshot.goalCompletion < 30 ? "high" : "medium",
      ),
    });
  }

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

  if (qrMomentum != null && qrMomentum < -15 && (input.qrAnalytics?.totalScans ?? 0) > 0) {
    out.push({
      id: "qr-scan-decline",
      messageKey: "business.team.performance.executive.risks.qrScanDecline",
      params: { percent: Math.abs(qrMomentum) },
      tone: "warning",
      ...trace(
        "qrScanTrend",
        "(secondHalfScanTrend - firstHalfScanTrend) / firstHalfScanTrend * 100",
        "business.team.performance.executive.evidence.qrScanDecline",
        { percent: qrMomentum, totalScans: input.qrAnalytics?.totalScans ?? 0 },
        "medium",
      ),
    });
  }

  const qr = input.qrAnalytics;
  if (qr && qr.scansByLocation.length >= 2 && qr.totalScans >= 10) {
    const sorted = [...qr.scansByLocation].sort((a, b) => b.count - a.count);
    const avg = qr.totalScans / sorted.length;
    const weakest = sorted[sorted.length - 1];
    if (weakest && weakest.count < avg * 0.35) {
      out.push({
        id: "location-underperformance",
        messageKey: "business.team.performance.executive.risks.locationUnderperformance",
        params: { location: weakest.label, count: weakest.count },
        tone: "warning",
        ...trace(
          "qrScansByLocation",
          "location.count < (totalScans / locationCount) * 0.35",
          "business.team.performance.executive.evidence.locationUnderperformance",
          { location: weakest.label, count: weakest.count, average: Math.round(avg) },
          "low",
        ),
      });
    }
  }

  const rated = input.employees.filter((e) => e.rating != null && e.rating > 0);
  if (rated.length >= 3) {
    const avgRating = rated.reduce((s, e) => s + (e.rating ?? 0), 0) / rated.length;
    if (avgRating < 3.5) {
      out.push({
        id: "satisfaction-decline",
        messageKey: "business.team.performance.executive.risks.satisfactionLow",
        params: { rating: Math.round(avgRating * 10) / 10 },
        tone: "warning",
        ...trace(
          "guestSatisfaction",
          "avg(employees.rating) where rating > 0",
          "business.team.performance.executive.evidence.satisfactionLow",
          { rating: Math.round(avgRating * 10) / 10, count: rated.length },
          avgRating < 3 ? "high" : "medium",
        ),
      });
    }
  }

  return out.slice(0, 6);
}

/** Recommendations derived only from detected risks and opportunities — never invented. */
export function generateExecutiveRecommendations(
  input: BusinessIntelligenceInput,
  risks: ExecutiveRisk[],
  opportunities: ExecutiveOpportunity[],
): ExecutiveRecommendation[] {
  const out: ExecutiveRecommendation[] = [];

  const addRec = (
    id: string,
    messageKey: string,
    source: IntelligenceTrace,
    tone: ExecutiveRecommendation["tone"] = "info",
    params?: Record<string, string | number>,
  ) => {
    if (out.some((r) => r.id === id)) return;
    out.push({ id, messageKey, tone, params, ...source });
  };

  if (risks.some((r) => r.id === "tip-volume-decline")) {
    addRec(
      "rec-boost-visibility",
      "business.team.performance.executive.recommendations.boostVisibility",
      trace("revenueGrowthPercent", "derived from tip-volume-decline risk", "business.team.performance.executive.evidence.recBoostVisibility"),
    );
  }

  if (
    risks.some((r) => r.id === "low-participation-risk" || r.id === "participation-decline")
  ) {
    addRec(
      "rec-promote-team-qrs",
      "business.team.performance.executive.recommendations.promoteTeamQrs",
      trace("employeeParticipation", "derived from participation risk", "business.team.performance.executive.evidence.recPromoteTeamQrs"),
    );
  }

  if (risks.some((r) => r.id === "goal-completion-risk")) {
    addRec(
      "rec-enable-goals",
      "business.team.performance.executive.recommendations.enableGoals",
      trace("goalCompletion", "derived from goal-completion-risk", "business.team.performance.executive.evidence.recEnableGoals"),
    );
  }

  if (risks.some((r) => r.id === "qr-scan-decline" || r.id === "location-underperformance")) {
    addRec(
      "rec-review-qr-placement",
      "business.team.performance.executive.recommendations.reviewQrPlacement",
      trace("qrScanTrend", "derived from QR risk", "business.team.performance.executive.evidence.recReviewQrPlacement"),
    );
  }

  if (risks.some((r) => r.id === "satisfaction-decline")) {
    addRec(
      "rec-review-feedback",
      "business.team.performance.executive.recommendations.reviewFeedback",
      trace("guestSatisfaction", "derived from satisfaction-decline risk", "business.team.performance.executive.evidence.recReviewFeedback"),
    );
  }

  const participationOpp = opportunities.find((o) => o.id === "low-participation");
  if (participationOpp) {
    addRec(
      "rec-promote-team-qrs",
      "business.team.performance.executive.recommendations.promoteTeamQrs",
      trace("employeeParticipation", "derived from low-participation opportunity", participationOpp.evidenceKey, participationOpp.evidenceParams),
      "info",
      participationOpp.params,
    );
  }

  const growthOpp = opportunities.find((o) => o.id === "tip-growth-opportunity");
  if (growthOpp) {
    addRec(
      "rec-maintain-momentum",
      "business.team.performance.executive.recommendations.maintainMomentum",
      trace("revenueGrowthPercent", "derived from tip-growth-opportunity", growthOpp.evidenceKey, growthOpp.evidenceParams),
      "success",
      growthOpp.params,
    );
  }

  const topLocation = opportunities.find((o) => o.id === "top-location");
  if (topLocation) {
    addRec(
      "rec-replicate-location",
      "business.team.performance.executive.recommendations.replicateLocation",
      trace("qrScansByLocation", "derived from top-location opportunity", topLocation.evidenceKey, topLocation.evidenceParams),
      "success",
      topLocation.params,
    );
  }

  const topEmployee = opportunities.find((o) => o.id === "employee-excellence");
  if (topEmployee) {
    addRec(
      "rec-recognize-performer",
      "business.team.performance.executive.recommendations.recognizePerformer",
      trace("employeeTipsTotal", "derived from employee-excellence opportunity", topEmployee.evidenceKey, topEmployee.evidenceParams),
      "success",
      topEmployee.params,
    );
  }

  return out.slice(0, 5);
}

export function generateOpportunities(input: BusinessIntelligenceInput): ExecutiveOpportunity[] {
  const ops = computeOperationalMetrics(input);
  const revenue = computeRevenueAnalytics(input);
  const qrMomentum = computeQrScanMomentum(input.qrAnalytics);
  const periodParticipation = computePeriodParticipationPct(input);
  const out: ExecutiveOpportunity[] = [];

  if (periodParticipation < 80 && ops.activeEmployees > 0) {
    out.push({
      id: "low-participation",
      messageKey: "business.team.performance.executive.opportunities.lowParticipation",
      params: { percent: periodParticipation },
      tone: "warning",
      ...trace(
        "employeeParticipation",
        "employeesReceivingTips / activeEmployees * 100",
        "business.team.performance.executive.evidence.lowParticipationOpp",
        { percent: periodParticipation, active: ops.activeEmployees },
        "low",
      ),
    });
  }

  if (input.pulse && input.pulse.goalsTracked < ops.activeEmployees / 2 && ops.activeEmployees > 0) {
    out.push({
      id: "team-goals",
      messageKey: "business.team.performance.executive.opportunities.teamGoals",
      tone: "info",
      ...trace(
        "goalsTracked",
        "pulse.goalsTracked < activeEmployees / 2",
        "business.team.performance.executive.evidence.teamGoalsOpp",
        { tracked: input.pulse.goalsTracked, active: ops.activeEmployees },
      ),
    });
  }

  if (revenue.growthPercent > 10) {
    out.push({
      id: "tip-growth-opportunity",
      messageKey: "business.team.performance.executive.opportunities.tipGrowth",
      params: { percent: revenue.growthPercent },
      tone: "success",
      ...trace(
        "revenueGrowthPercent",
        "(period.totalTips - priorPeriod.totalTips) / priorPeriod.totalTips * 100",
        "business.team.performance.executive.evidence.tipGrowthOpp",
        { percent: revenue.growthPercent },
      ),
    });
  }

  if (qrMomentum != null && qrMomentum > 15) {
    out.push({
      id: "qr-scan-growth",
      messageKey: "business.team.performance.executive.opportunities.qrScanGrowth",
      params: { percent: qrMomentum },
      tone: "success",
      ...trace(
        "qrScanTrend",
        "(secondHalfScanTrend - firstHalfScanTrend) / firstHalfScanTrend * 100",
        "business.team.performance.executive.evidence.qrScanGrowthOpp",
        { percent: qrMomentum, totalScans: input.qrAnalytics?.totalScans ?? 0 },
      ),
    });
  }

  const qr = input.qrAnalytics;
  if (qr && qr.scansByLocation.length > 0) {
    const top = [...qr.scansByLocation].sort((a, b) => b.count - a.count)[0];
    if (top && top.count >= 5) {
      out.push({
        id: "top-location",
        messageKey: "business.team.performance.executive.opportunities.topLocation",
        params: { location: top.label, count: top.count },
        tone: "success",
        ...trace(
          "qrScansByLocation",
          "max(scansByLocation.count)",
          "business.team.performance.executive.evidence.topLocationOpp",
          { location: top.label, count: top.count },
        ),
      });
    }
  }

  if (qr && qr.scansByTable.length > 0) {
    const topTable = [...qr.scansByTable].sort((a, b) => b.count - a.count)[0];
    if (topTable && topTable.count >= 3) {
      out.push({
        id: "top-table",
        messageKey: "business.team.performance.executive.opportunities.topTable",
        params: { table: topTable.label, count: topTable.count },
        tone: "success",
        ...trace(
          "qrScansByTable",
          "max(scansByTable.count)",
          "business.team.performance.executive.evidence.topTableOpp",
          { table: topTable.label, count: topTable.count },
        ),
      });
    }
  }

  const topEarner = [...input.employees]
    .filter((e) => e.tipsTotal > 0)
    .sort((a, b) => b.tipsTotal - a.tipsTotal)[0];
  if (topEarner && topEarner.tipsTotal > 0 && input.period.totalTips > 0) {
    const share = Math.round((topEarner.tipsTotal / input.period.totalTips) * 100);
    if (share >= 15) {
      out.push({
        id: "employee-excellence",
        messageKey: "business.team.performance.executive.opportunities.employeeExcellence",
        params: { name: topEarner.name, share },
        tone: "success",
        ...trace(
          "employeeTipsTotal",
          "max(employees.tipsTotal) / period.totalTips * 100",
          "business.team.performance.executive.evidence.employeeExcellenceOpp",
          { name: topEarner.name, share, tips: Math.round(topEarner.tipsTotal) },
        ),
      });
    }
  }

  const tableComparison = computeTableComparisons(input);
  if (tableComparison.length > 0 && tableComparison[0].share >= 20) {
    out.push({
      id: "top-tipping-table",
      messageKey: "business.team.performance.executive.opportunities.topTippingTable",
      params: { table: tableComparison[0].label, share: tableComparison[0].share },
      tone: "success",
      ...trace(
        "tipsByTable",
        "max(recentTips grouped by tableName).share",
        "business.team.performance.executive.evidence.topTippingTableOpp",
        { table: tableComparison[0].label, share: tableComparison[0].share },
      ),
    });
  }

  return out.slice(0, 6);
}

/** Factual executive summary — rule-assembled clauses, no AI wording. */
export function generateExecutiveSummary(
  input: BusinessIntelligenceInput,
  ctx: {
    revenue: RevenueAnalytics;
    snapshot: PerformanceSnapshot;
    risks: ExecutiveRisk[];
    opportunities: ExecutiveOpportunity[];
    qrAnalytics: BusinessQrAnalytics | null;
  },
): ExecutiveSummary {
  const clauses: ExecutiveSummary["clauses"] = [];

  if (ctx.revenue.growthPercent > 5) {
    clauses.push({
      key: "business.team.performance.executive.summary.revenueHealthy",
      params: { percent: ctx.revenue.growthPercent },
    });
  } else if (ctx.revenue.growthPercent < -5) {
    clauses.push({
      key: "business.team.performance.executive.summary.revenueDeclining",
      params: { percent: Math.abs(ctx.revenue.growthPercent) },
    });
  } else if (ctx.revenue.tipCount > 0) {
    clauses.push({ key: "business.team.performance.executive.summary.revenueStable" });
  }

  const qrMomentum = computeQrScanMomentum(ctx.qrAnalytics ?? undefined);
  if (qrMomentum != null && qrMomentum > 10) {
    clauses.push({
      key: "business.team.performance.executive.summary.qrGrowing",
      params: { percent: qrMomentum },
    });
  } else if (ctx.risks.some((r) => r.id === "qr-scan-decline")) {
    clauses.push({ key: "business.team.performance.executive.summary.qrDeclining" });
  }

  if (ctx.risks.some((r) => r.id === "participation-decline" || r.id === "low-participation-risk")) {
    const period = computePeriodParticipationPct(input);
    const week = computeWeekParticipationPct(input);
    if (week > 0 && week < period) {
      clauses.push({
        key: "business.team.performance.executive.summary.participationConcern",
        params: { from: period, to: week },
      });
    } else {
      clauses.push({
        key: "business.team.performance.executive.summary.participationConcernLow",
        params: { percent: period },
      });
    }
  } else if (ctx.snapshot.employeeParticipation >= 70) {
    clauses.push({
      key: "business.team.performance.executive.summary.participationStrong",
      params: { percent: ctx.snapshot.employeeParticipation },
    });
  }

  if (ctx.risks.some((r) => r.id === "goal-completion-risk")) {
    clauses.push({
      key: "business.team.performance.executive.summary.goalsNeedAttention",
      params: { percent: ctx.snapshot.goalCompletion },
    });
  }

  if (clauses.length === 0) {
    clauses.push({ key: "business.team.performance.executive.summary.collectingData" });
  }

  return {
    messageKey: "business.team.performance.executive.summary.composite",
    params: { clauseCount: clauses.length },
    clauses: clauses.slice(0, 3),
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
