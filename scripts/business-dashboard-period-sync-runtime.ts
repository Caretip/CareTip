/**
 * Business dashboard — period toggle stays aligned with chart/KPI timeframe.
 * Run: npm run test:business-dashboard-period-sync
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveTipPerformanceChartRows } from "../src/app/lib/businessDashboardChartData.ts";
import { dominantFeedbackTagFromItems } from "../src/app/lib/customerFeedbackDashboardInsights.ts";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function pass(msg: string) {
  console.log(`PASS: ${msg}`);
}

const dash = readFileSync(path.join(root, "src/app/pages/business/BusinessDashboard.tsx"), "utf8");
assert.match(dash, /value=\{analyticsTimeframe\}/);
assert.match(dash, /analyticsTimeframe=\{analyticsTimeframe\}/);
assert.doesNotMatch(dash, /"today"/);
assert.match(dash, /BusinessDashboardOverviewSection/);
assert.match(dash, /business-overview-period/);
const dashStats = readFileSync(path.join(root, "src/app/hooks/useBusinessDashboardStats.ts"), "utf8");
assert.match(dashStats, /scope:\s*advancedAnalyticsEnabledRef\.current\s*\?\s*"aboveFold"\s*:\s*"summary"/);
assert.match(dashStats, /scope:\s*"analytics"/);
assert.doesNotMatch(dashStats, /scope:\s*advancedAnalyticsEnabledRef\.current\s*\?\s*"full"/);
pass("BusinessDashboard KPIs and charts share analyticsTimeframe (no Today toggle)");
pass("BusinessDashboard uses formal overview period section");
pass("Business dashboard stats use aboveFold then analytics (not scope=full)");

const resolved = resolveTipPerformanceChartRows({
  rows: [
    { day: "Mon", amount: 10 },
    { day: "Tue", amount: 5 },
  ],
  timeframe: "week",
  t: (k) => k,
  periodTotalTips: 15,
});
assert.ok(resolved);
assert.equal(resolved!.reduce((s, r) => s + r.amount, 0), 15);
pass("Week chart rows reconcile with period KPI");

const tag = dominantFeedbackTagFromItems([
  {
    id: "1",
    transactionId: "t",
    employeeId: "e",
    employeeName: "A",
    rating: 5,
    comment: null,
    tags: ["attentive", "friendly"],
    customerName: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "2",
    transactionId: "t2",
    employeeId: "e",
    employeeName: "A",
    rating: 5,
    comment: "Great",
    tags: ["attentive"],
    customerName: null,
    createdAt: "2026-01-02T00:00:00.000Z",
  },
]);
assert.equal(tag, "attentive");
pass("Dashboard feedback snapshot picks dominant tag from loaded items");

console.log("\nBusiness dashboard period sync checks passed.");
