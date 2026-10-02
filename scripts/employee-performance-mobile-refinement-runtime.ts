/**
 * Employee/business dashboard period hero + mobile teaser density contracts.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  const abs = path.join(repoRoot, rel);
  if (!existsSync(abs)) throw new Error(`missing: ${rel}`);
  return readFileSync(abs, "utf8");
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const overview = read("src/app/components/business/BusinessDashboardOverviewSection.tsx");
const overviewCss = read("src/styles/business-overview-workspace.css");
const employeeDash = read("src/app/pages/employee/EmployeeDashboard.tsx");
const employeeCss = read("src/styles/employee-earnings-cockpit.css");
const businessDash = read("src/app/pages/business/BusinessDashboard.tsx");
const feedback = read("src/app/components/business/RecentCustomerFeedbackPanel.tsx");
const limits = read("src/app/lib/dashboardTeaserLimits.ts");

assert(overview.includes("business-overview-section__meta"), "period hero meta row");
assert(!overview.includes("business-overview-section__actions"), "removed side-by-side actions column");
assert(overviewCss.includes("business-overview-section__desc"), "description width styling");

assert(employeeDash.includes("employee-dashboard-analytics-intro__meta"), "employee meta below copy");
assert(employeeDash.includes("analyticsSectionEyebrow"), "employee eyebrow");
assert(employeeCss.includes("employee-dashboard-analytics-intro__desc"), "employee description styling");

assert(limits.includes("DASHBOARD_MOBILE_TEASER_LIMIT = 2"), "mobile teaser limit");
assert(businessDash.includes("DASHBOARD_MOBILE_TEASER_LIMIT"), "business goals mobile limit");
assert(feedback.includes("DASHBOARD_MOBILE_TEASER_LIMIT"), "feedback mobile limit");

console.log("employee-performance-mobile-refinement-runtime: ok");
