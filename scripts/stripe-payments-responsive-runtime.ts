/**
 * Stripe payments responsive/adaptive contracts (no live Stripe calls).
 * Run: npm run test:stripe-payments-responsive
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  employeeInstantCtaEnabled,
  employeeInstantShowCta,
  employeeInstantUiMode,
} from "../src/app/components/employee/employeeInstantPayoutPresentation.ts";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

type Result = { id: string; pass: boolean; detail: string };
const results: Result[] = [];
function pass(id: string, detail: string) {
  results.push({ id, pass: true, detail });
}
function fail(id: string, detail: string) {
  results.push({ id, pass: false, detail });
}
function read(rel: string): string {
  return readFileSync(path.join(repoRoot, rel), "utf8");
}
function exists(rel: string): boolean {
  return existsSync(path.join(repoRoot, rel));
}

const payoutsPanel = read("src/app/components/business/settings/billing/ConnectPayoutsPanel.tsx");
if (payoutsPanel.includes("order-2 min-w-0 rounded-2xl") && payoutsPanel.includes("order-1 min-w-0 space-y-4 xl:order-2")) {
  pass("business-instant-order", "Business Instant rail is order-1 on mobile; history is order-2 / xl:order-1");
} else fail("business-instant-order", "missing mobile Instant-first order classes");

if (payoutsPanel.includes('eligibility.reason === "below_minimum"') && payoutsPanel.includes("aria-disabled")) {
  pass("business-below-min-cta", "Business Instant keeps a disabled CTA when below minimum / zero balance");
} else fail("business-below-min-cta", "disabled below-min Instant CTA missing");

if (payoutsPanel.includes("businessUi.mobileList") && payoutsPanel.includes("min-w-[720px]") && payoutsPanel.includes("businessUi.tableWrap")) {
  pass("business-history-adaptive", "Business history uses mobile cards + desktop table (min-width only on lg table)");
} else fail("business-history-adaptive", "history adaptive pattern missing");

if (payoutsPanel.includes("md:grid-cols-3") && payoutsPanel.includes("md:min-h-[8.25rem]")) {
  pass("business-kpi-breakpoint", "Business KPI cards stack until md instead of squeezing at 640px");
} else fail("business-kpi-breakpoint", "KPI breakpoint not updated");

const employeeConnect = read("src/app/pages/employee/EmployeePaymentsConnectPage.tsx");
if (employeeConnect.includes("order-1 min-w-0 space-y-4 xl:order-2") && employeeConnect.includes("EmployeeInstantPayoutCard")) {
  pass("employee-instant-order", "Employee Connect Instant rail is first on mobile");
} else fail("employee-instant-order", "employee Instant order missing");

if (!employeeConnect.includes("Payments → Overview") && !employeeConnect.includes("payoutsOverview")) {
  pass("no-overview-page", "Employee Payments still Connect + history; no Overview IA");
} else fail("no-overview-page", "unexpected Overview IA");

const employeeHistory = read("src/app/pages/employee/EmployeePayoutHistoryPage.tsx");
if (employeeHistory.includes("employee.payouts.history.caretipTab") && employeeHistory.includes("employee.payouts.history.bankTab") && employeeHistory.includes("whitespace-normal")) {
  pass("employee-history-tabs", "CareTip transfers vs bank payouts tabs wrap on narrow widths");
} else fail("employee-history-tabs", "history tabs wrap missing");

const detail = read("src/app/components/connect/ConnectPayoutDetailDialog.tsx");
if (detail.includes("payout.id") && detail.includes("break-all font-mono")) {
  pass("full-payout-id", "Shortened Stripe IDs remain accessible in payout detail");
} else fail("full-payout-id", "full payout.id not in detail dialog");

const nav = read("src/app/components/employee/employeeDashboardNav.ts");
if (nav.includes("EMPLOYEE_PAYMENTS_HISTORY_HREF") && exists("src/app/pages/employee/EmployeePaymentsConnectPage.tsx")) {
  pass("employee-ia", "Employee payments nav still Connect + payout history");
} else fail("employee-ia", "employee payments nav missing");

const below = employeeInstantUiMode({ eligible: false, reason: "below_minimum" });
if (below === "threshold" && employeeInstantShowCta(below) && !employeeInstantCtaEnabled(below)) {
  pass("employee-below-min", "Employee Instant CTA stays visible and disabled below minimum");
} else fail("employee-below-min", String(below));

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.id} — ${r.detail}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
