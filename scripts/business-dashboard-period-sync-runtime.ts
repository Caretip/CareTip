/**
 * Business dashboard — period toggle stays aligned with chart/KPI timeframe.
 * Run: npm run test:business-dashboard-period-sync
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveTipPerformanceChartRows } from "../src/app/lib/businessDashboardChartData.ts";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function pass(msg: string) {
  console.log(`PASS: ${msg}`);
}

const dash = readFileSync(path.join(root, "src/app/pages/business/BusinessDashboard.tsx"), "utf8");
assert.match(dash, /value=\{analyticsTimeframe\}/);
assert.match(dash, /analyticsTimeframe=\{analyticsTimeframe\}/);
assert.doesNotMatch(dash, /"today"/);
pass("BusinessDashboard KPIs and charts share analyticsTimeframe (no Today toggle)");

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

console.log("\nBusiness dashboard period sync checks passed.");
