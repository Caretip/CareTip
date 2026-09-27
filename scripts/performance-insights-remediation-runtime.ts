/**
 * Performance insights remediation — deterministic BI rule regressions.
 * Run: npm run test:performance-insights-remediation
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildTrendChartSeries,
  computeRevenueAnalytics,
  generateExecutiveInsights,
  generateExecutiveRecommendations,
  generateExecutiveRisks,
  generateExecutiveSummary,
  generateOpportunities,
  type BusinessIntelligenceInput,
} from "../src/app/lib/businessIntelligence.ts";
import { runBusinessIntelligenceEngine } from "../src/app/lib/businessIntelligenceEngine.ts";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

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

const en = readFileSync(path.join(repoRoot, "src/i18n/locales/en.json"), "utf8");
const de = readFileSync(path.join(repoRoot, "src/i18n/locales/de.json"), "utf8");

assert(en.includes("previous equal-length period"), "EN uses equal-length prior wording in summary");
assert(
  en.includes("Tips are up {{percent}}% compared with the previous equal-length period."),
  "EN executive summary growth wording is factual",
);
assert(de.includes("gleich langen Zeitraum"), "DE growth summary uses equal-length prior wording");

const growthInput = biInput({
  period: { totalTips: 200, tipCount: 10, averageTip: 20 },
  priorPeriod: { totalTips: 100, tipCount: 5 },
});
const revenue = computeRevenueAnalytics(growthInput);
assert(revenue.growthComparable && revenue.growthPercent === 100, "growth math unchanged (100% vs prior)");

const risksGrowth = generateExecutiveRisks(growthInput);
assert(
  !risksGrowth.some((r) => r.id === "tip-volume-decline"),
  "tip decline is not emitted as a risk",
);
assert(
  !risksGrowth.some((r) => r.id === "participation-decline"),
  "misleading participation-decline risk removed",
);

const noTipInput = biInput({
  period: { totalTips: 0, tipCount: 0, averageTip: 0 },
  employees: [{ id: "1", name: "A", tipCount: 0, tipsTotal: 0, isActive: true } as never],
  pulse: { tippingReadyEmployees: 1, rosterTotal: 1 } as never,
});
const noTipRisks = generateExecutiveRisks(noTipInput);
assert(noTipRisks.length === 1 && noTipRisks[0].id === "no-tip-activity", "no-tip operational risk retained");

const opps = generateOpportunities(growthInput);
assert(opps.length === 0, "opportunities section empty by design (deduplication)");

const recs = generateExecutiveRecommendations(growthInput, noTipRisks, opps);
assert(recs.length === 0, "no generic playbook recommendations");

const insights = generateExecutiveInsights(
  biInput({
    period: { totalTips: 100, tipCount: 5, averageTip: 20 },
    priorPeriod: { totalTips: 50, tipCount: 2 },
    peakHour: 14,
    recentTips: [],
  }),
);
assert(!insights.some((i) => i.id === "tip-growth"), "executive insights omit duplicate growth narrative");
assert(
  !insights.some((i) => i.id === "participation"),
  "executive insights omit misleading participation comparison",
);

const trends = buildTrendChartSeries(
  biInput({
    dailyTipDistribution: [{ day: "Mon", amount: 40 }],
    period: { totalTips: 40, tipCount: 2, averageTip: 20 },
  }),
);
assert(
  trends.tipVolumeTrend[0]?.tips === 40 && !("participationTrend" in trends),
  "trend series is tip volume (€), not mislabeled participation",
);

const engine = runBusinessIntelligenceEngine(
  biInput({
    period: { totalTips: 120, tipCount: 6, averageTip: 20 },
    priorPeriod: { totalTips: 100, tipCount: 5 },
    dailyTipDistribution: [{ day: "01", amount: 10 }],
  }),
);
assert(engine.recommendations.length === 0, "engine emits no recommendations by default");
assert(engine.opportunities.length === 0, "engine emits no opportunities by default");

const summary = generateExecutiveSummary(growthInput, {
  revenue,
  snapshot: engine.snapshot,
  risks: [],
  opportunities: [],
  qrAnalytics: null,
});
assert(summary.clauses.length === 1, "executive summary capped at one clause");
assert(
  summary.clauses[0]?.key.includes("revenueHealthy"),
  "summary uses factual growth clause when comparable",
);

const failed = results.filter((r) => r.startsWith("FAIL:"));
console.log(results.join("\n"));
if (failed.length > 0) {
  console.error(`\n${failed.length} failure(s)`);
  process.exit(1);
}
console.log(`\nAll ${results.length} checks passed.`);
