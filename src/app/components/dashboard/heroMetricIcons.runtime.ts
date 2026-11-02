/**
 * Dashboard hero metrics are text only — no label icons on business or employee dashboards.
 * Run: node ./node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json ./src/app/components/dashboard/heroMetricIcons.runtime.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

const layout = read("src/app/components/dashboard/DashboardHeroFinancialLayout.tsx");
assert(layout.includes("function MetricLabel"), "shared label row");
assert(!layout.includes("primary.icon"), "primary amount has no icon");
assert(layout.includes("dashboard-hero-financial__zone--primary"), "primary zone remains");

const business = read("src/app/components/business/BusinessHeroFinancialMetrics.tsx");
assert(!business.includes("lucide-react"), "business hero metrics have no icons");
assert(!/\bicon:/.test(business), "business hero metrics pass no icon");
assert(business.includes('label: t("business.hero.financial.totalTips")'), "business primary label unchanged");

const employee = read("src/app/components/employee/EmployeeHeroFinancialPanel.tsx");
assert(!employee.includes("lucide-react"), "employee hero metrics have no icons");
assert(!/\bicon:/.test(employee), "employee hero metrics pass no icon");
assert(employee.includes('label: t("employee.hero.statYourEarnings")'), "employee primary label unchanged");
assert(employee.includes('hint: t("employee.hero.statYourEarningsHint")'), "earnings note stays under the amount");

const mobile = read("src/styles/business-web-design.css");
assert(mobile.includes("grid-template-rows: subgrid"), "mobile metric rows share label and value tracks");
assert(mobile.includes("grid-row: span 2"), "each supporting metric spans its row pair");

console.log("hero-metric-icons: ok");
