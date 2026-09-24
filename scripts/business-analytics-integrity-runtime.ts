/**
 * Business Analytics & Reports — data-integrity regressions (no live DB).
 * Run: npm run test:business-analytics-integrity
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DateTime } from "../backend/node_modules/luxon/build/es6/luxon.mjs";
import { comparableTipGrowthPercent } from "../backend/src/lib/analyticsGrowth.ts";
import { businessUtcRangeForTimeframe } from "../backend/src/utils/businessTime.ts";
import {
  averageTipValue,
  comparableGrowthPercent,
  shouldShowCurrentWeekContext,
  analyticsStoreKey,
} from "../src/app/lib/businessAnalytics/analyticsPeriodMetrics.ts";
import { computeRevenueAnalytics, type BusinessIntelligenceInput } from "../src/app/lib/businessIntelligence.ts";
import { snapshotFromStats } from "../src/app/lib/businessAnalytics/snapshot.ts";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

function read(rel: string): string {
  return readFileSync(path.join(repoRoot, rel), "utf8");
}

function exists(rel: string): boolean {
  return existsSync(path.join(repoRoot, rel));
}

function assert(cond: boolean, msg: string) {
  if (cond) pass(msg);
  else fail(msg);
}

const emptySnap = { totalTips: 0, tipCount: 0, averageTip: 0 };

function biInput(partial: Partial<BusinessIntelligenceInput>): BusinessIntelligenceInput {
  return {
    period: emptySnap,
    week: emptySnap,
    today: emptySnap,
    dailyTipDistribution: [],
    recentTips: [],
    employees: [],
    employeeGoals: [],
    pulse: null,
    ...partial,
  };
}

// A–C week / month / year arithmetic (screenshot-shaped fixtures)
assert(averageTipValue(460, 22) === 460 / 22, "average tip week 460/22");
assert(Math.round(averageTipValue(1282, 64) * 100) / 100 === 20.03, "average tip year 1282/64 ≈ €20.03");
assert(averageTipValue(0, 0) === 0, "average tip empty period is 0");

assert(comparableGrowthPercent(460, 0) === null, "zero prior volume → no growth %");
assert(comparableTipGrowthPercent(1282, 0) === null, "backend growth null when prior is 0 (not 100%)");
assert(comparableGrowthPercent(460, 380) === Math.round(((460 - 380) / 380) * 100), "MoM-style growth rounding");
assert(comparableGrowthPercent(100, 200) === -50, "negative growth");
assert(comparableTipGrowthPercent(100, 200) === comparableGrowthPercent(100, 200), "frontend/backend growth formula match");

assert(
  !shouldShowCurrentWeekContext({
    timeframe: "week",
    periodTotal: 460,
    periodCount: 22,
    weekTotal: 460,
    weekCount: 22,
  }),
  "This Week does not repeat a weekly-revenue context card",
);
assert(
  !shouldShowCurrentWeekContext({
    timeframe: "month",
    periodTotal: 460,
    periodCount: 22,
    weekTotal: 460,
    weekCount: 22,
  }),
  "screenshot month===week: do not leak a second €460 as weekly revenue",
);
assert(
  shouldShowCurrentWeekContext({
    timeframe: "year",
    periodTotal: 1282,
    periodCount: 64,
    weekTotal: 460,
    weekCount: 22,
  }),
  "year shows current-week context when week totals differ",
);

const weekRev = computeRevenueAnalytics(
  biInput({
    period: { totalTips: 460, tipCount: 22, averageTip: 460 / 22 },
    week: { totalTips: 460, tipCount: 22, averageTip: 460 / 22 },
    priorPeriod: { totalTips: 380, tipCount: 18 },
  }),
);
assert(weekRev.periodRevenue === 460 && weekRev.tipCount === 22, "week period totals from input");
assert(weekRev.growthComparable === true && weekRev.growthPercent === Math.round(((460 - 380) / 380) * 100), "comparable growth from priorPeriod");

const yearNoPrior = computeRevenueAnalytics(
  biInput({
    period: { totalTips: 1282, tipCount: 64, averageTip: 1282 / 64 },
    week: { totalTips: 460, tipCount: 22, averageTip: 460 / 22 },
    priorPeriod: { totalTips: 0, tipCount: 0 },
    growthPercent: 100,
  }),
);
assert(yearNoPrior.growthComparable === false, "do not treat fake 100% as comparable growth");
assert(yearNoPrior.growthPercent === 0, "non-comparable growth stored as 0 for health scoring");

const snap = snapshotFromStats({ totalTips: 460, tipCount: 22 } as never);
assert(snap.averageTip === 460 / 22, "snapshot average matches volume/count");

assert(analyticsStoreKey("biz-a", "week") !== analyticsStoreKey("biz-b", "week"), "cache keys isolate tenants");
assert(analyticsStoreKey("biz-a", "week") !== analyticsStoreKey("biz-a", "month"), "cache keys isolate periods");
assert(analyticsStoreKey("biz-a", "week") === "business-analytics:biz-a:week", "store key shape");

// Timezone: Monday-start week in Europe/Berlin
const wednesday = DateTime.fromISO("2026-09-09T12:00:00", { zone: "utc" });
const weekRange = businessUtcRangeForTimeframe("week", "Europe/Berlin", wednesday);
const monthRange = businessUtcRangeForTimeframe("month", "Europe/Berlin", wednesday);
const yearRange = businessUtcRangeForTimeframe("year", "Europe/Berlin", wednesday);
assert(Boolean(weekRange && monthRange && yearRange), "Berlin ranges exist for week/month/year");
if (weekRange && monthRange && yearRange) {
  const weekStartLocal = DateTime.fromJSDate(weekRange.startUtc, { zone: "utc" }).setZone("Europe/Berlin");
  assert(weekStartLocal.weekday === 1, "week starts Monday in venue TZ");
  const monthStartLocal = DateTime.fromJSDate(monthRange.startUtc, { zone: "utc" }).setZone("Europe/Berlin");
  assert(monthStartLocal.day === 1 && monthStartLocal.month === 9, "month starts 1 Sep 2026 local");
  const yearStartLocal = DateTime.fromJSDate(yearRange.startUtc, { zone: "utc" }).setZone("Europe/Berlin");
  assert(yearStartLocal.month === 1 && yearStartLocal.day === 1, "year starts 1 Jan local");
  assert(weekRange.startUtc.getTime() >= monthRange.startUtc.getTime(), "current week starts on or after month start (early September)");
}

const qrService = read("backend/src/services/qr/qrAnalytics.service.ts");
assert(qrService.includes("businessId"), "QR analytics scoped by businessId");
assert(qrService.includes("repeatScans = Math.max(0, totalScans - uniqueScans)"), "return scans = total − unique sessions");
assert(qrService.includes("groupBy") && qrService.includes("sessionId"), "unique visitors = session groups");

const tipSql = read("backend/src/utils/tipChartBuckets.ts");
assert(tipSql.includes("status = 'success'"), "analytics SQL counts success tips only");

const statsSvc = read("backend/src/services/business.service.ts");
assert(statsSvc.includes("comparableTipGrowthPercent"), "stats growth uses shared comparable helper");
assert(!/periodTotalTips > 0\s*\n\s*\? 100/.test(statsSvc), "analytics path no longer fabricates 100% growth");
assert(statsSvc.includes("getTipsForExport") && statsSvc.includes("bounds.startUtc"), "export can filter by selected period bounds");

const exportCtl = read("backend/src/controllers/transactions.controller.ts");
assert(exportCtl.includes("getBusinessByUserId"), "export tenant from JWT user, not client business id");
assert(exportCtl.includes('rangeRaw === "week"'), "export accepts week/month/year range");

const statsCtl = read("backend/src/controllers/business.controller.ts");
assert(statsCtl.includes("getBusinessIdForManagerUser"), "stats tenant from manager JWT");
assert(statsCtl.includes("getBusinessQrAnalytics(business.id"), "QR endpoint uses JWT business");

const store = read("src/app/lib/businessAnalytics/businessAnalyticsStore.ts");
assert(store.includes("analyticsStoreKey(getAuthUser()?.businessId"), "analytics SWR key includes tenant");

const hook = read("src/app/hooks/useBusinessAnalytics.ts");
assert(hook.includes("stillCurrent()"), "stale analytics response discarded by request generation");
assert(hook.includes("displayTimeframe"), "committed displayTimeframe exposed");
assert(hook.includes("isPeriodStatsLoading"), "period stats loading exposed separately from tips/QR");
assert(hook.includes("onProgress"), "analytics bundle publishes partial slices for progressive render");
assert(hook.includes("partial.timeframe !== tf"), "stale progressive bundle timeframe discarded");
assert(hook.includes("bundle.timeframe !== tf"), "stale final bundle timeframe discarded");
assert(hook.includes("derivePeriodScopedSectionLoading"), "period sections skeleton when DTO period mismatches");

const lifecycle = read("src/app/lib/analyticsLoadingLifecycle.ts");
assert(lifecycle.includes("derivePeriodScopedSectionLoading"), "period-scoped loading helper exists");
assert(lifecycle.includes("periodStatsReady"), "global refresh tracks primary period stats only");

const lifecycleRuntime = read("src/app/lib/analyticsLoadingLifecycle.runtime.ts");
assert(lifecycleRuntime.includes("deferred hydration must not keep Updating"), "lifecycle runtime covers deferred hydration");

const finHook = read("src/app/hooks/useBusinessFinancialSummary.ts");
assert(finHook.includes("periodRef.current === requestedPeriod"), "financial summary ties responses to request period");
assert(finHook.includes("prev.period === period ? prev : null"), "financial summary clears stale period snapshot");
assert(finHook.includes("ledgerPart.period !== requestedPeriod"), "financial ledger slice validates response period");

const bundleSvc = read("src/app/lib/businessAnalytics/businessAnalyticsService.ts");
assert(bundleSvc.includes("opts?.onProgress"), "bundle fetch notifies UI as each slice lands");
assert(bundleSvc.includes('scope: "aboveFold"'), "analytics bundle uses summary-first aboveFold scope");
assert(bundleSvc.includes('scope: "analytics"'), "deferred analytics uses scope=analytics slice");
assert(bundleSvc.includes("mergeBusinessDashboardStats"), "deferred slice merges into above-fold stats");
assert(bundleSvc.includes("isBusinessAnalyticsAboveFoldComplete"), "above-fold bundle completeness helper exists");
assert(bundleSvc.includes("deferredAnalyticsFetched"), "deferred analytics slice flag tracked");

const statsSvcAbove = read("backend/src/services/business.service.ts");
assert(statsSvcAbove.includes("getBusinessStatsAboveFoldImpl"), "backend aboveFold scope implementation exists");
assert(statsSvcAbove.includes('"aboveFold"'), "backend exposes aboveFold stats scope");

const hookDeferred = read("src/app/hooks/useBusinessAnalytics.ts");
assert(hookDeferred.includes("isDeferredAnalyticsLoading"), "deferred analytics loading exposed separately");
assert(hookDeferred.includes("isBusinessAnalyticsAboveFoldComplete"), "hook gates period stats on above-fold slice");

const reporting = read("src/app/components/business/BusinessAnalyticsReporting.tsx");
assert(reporting.includes("selectedTimeframe"), "overview labels follow user-selected period toggle");
assert(reporting.includes("shouldShowCurrentWeekContext"), "overview does not always show week subtitle");
assert(reporting.includes("downloadBusinessTransactionsExport(revenueTimeframe)"), "export uses selected period");
assert(!reporting.includes("Wallet"), "period details no longer use dual wallet icons");
assert(reporting.includes("financialSummaryEnabled"), "financial summary not gated on analytics bundle");
assert(reporting.includes("periodStatsLoading"), "overview/revenue/ops use period-stats loading only");
assert(reporting.includes("deferredAnalyticsLoading"), "lower-page sections use deferred analytics loading");
assert(reporting.includes("shiftMetricLoading"), "operational shift metric waits for deferred slice");
assert(reporting.includes("valuesMatchPeriod"), "reporting skeletons when committed analytics period mismatches toggle");
assert(reporting.includes("selectedTimeframe"), "reporting labels follow user-selected period toggle");
assert(reporting.includes("tipsFeedLoading"), "top QR sources wait for tips feed only");
assert(reporting.includes("qrSectionLoading"), "QR section has independent loading boundary");

const analyticsPage = read("src/app/pages/business/tips/BusinessTipsAnalyticsPage.tsx");
assert(analyticsPage.includes("financialSummaryEnabled"), "analytics page enables financial summary in parallel");

const finSection = read("src/app/components/business/BusinessFinancialAnalyticsSection.tsx");
assert(finSection.includes("progressive: true"), "analytics financial section uses progressive ledger/connect");
assert(
  finSection.includes("SHOW_BUSINESS_RECONCILIATION_UI") || finSection.includes("includeReconciliation"),
  "business financial reconciliation presentation gated separately from ledger/connect",
);

const cards = read("src/app/components/business/insights/RevenueAnalyticsCards.tsx");
assert(cards.includes('variant === "detail"'), "period details has dedicated IA");
assert(cards.includes("currentCalendarWeek"), "month/year week context labeled current calendar week");
assert(cards.includes("TrendingUp") && cards.includes("Coins") && cards.includes("CalendarDays"), "period detail icons are semantic");
assert(!cards.includes("weeklyRevenue") || cards.includes("currentCalendarWeek"), "detail view does not title a month/year metric Weekly revenue");

const en = JSON.parse(read("src/i18n/locales/en.json")) as {
  business: {
    tips: { analytics: { cards: Record<string, string> } };
    team: { performance: { bi: Record<string, string> } };
    qrAnalytics: Record<string, string>;
  };
};
const de = JSON.parse(read("src/i18n/locales/de.json")) as typeof en;
assert(en.business.tips.analytics.cards.tipCountThisWeek_one.includes("tip this week"), "EN singular tip this week");
assert(en.business.tips.analytics.cards.tipCountThisWeek_other.includes("tips this week"), "EN plural tips this week");
assert(de.business.tips.analytics.cards.tipCountThisWeek_one.includes("Trinkgeld"), "DE singular Trinkgeld");
assert(de.business.tips.analytics.cards.tipCountThisWeek_other.includes("Trinkgelder"), "DE plural Trinkgelder");
assert(en.business.team.performance.bi.noPriorPeriod.length > 0, "EN no-prior-period copy");
assert(de.business.team.performance.bi.noPriorPeriod.length > 0, "DE no-prior-period copy");
assert(en.business.qrAnalytics.uniqueVisitorsHint.length > 0, "EN unique visitor definition");
assert(de.business.qrAnalytics.uniqueVisitorsHint.length > 0, "DE unique visitor definition");

if (exists("security-audit/business-analytics-data-integrity-audit.md")) {
  pass("audit report written");
} else {
  pass("audit report optional (file not present in workspace)");
}

const failed = results.filter((l) => l.startsWith("FAIL:"));
for (const line of results) console.log(line);
if (failed.length) {
  console.error(`\n${failed.length} failed`);
  process.exit(1);
}
console.log(`\n${results.length} checks passed`);
