/**
 * Supporting hero metrics carry a label icon. The primary amount does not.
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
for (const icon of ["Wallet", "Clock", "CircleCheck", "Users"]) {
  assert(business.includes(icon), `business ${icon}`);
}
assert(business.includes('label: t("business.hero.financial.totalTips")'), "business primary label unchanged");
assert(!business.includes("totalTips\",\n        icon"), "no icon on total tips");

const employee = read("src/app/components/employee/EmployeeHeroFinancialPanel.tsx");
for (const icon of ["CircleCheck", "Clock", "Coins", "Receipt"]) {
  assert(employee.includes(icon), `employee ${icon}`);
}
assert(employee.includes('label: t("employee.hero.statYourEarnings")'), "employee primary label unchanged");

const css = read("src/styles/dashboard-hero-financial.css");
assert(css.includes("dashboard-hero-financial__metric-icon"), "shared icon treatment");
assert(css.includes("hsl(var(--primary))"), "icons use the brand accent");

console.log("hero-metric-icons: ok");
