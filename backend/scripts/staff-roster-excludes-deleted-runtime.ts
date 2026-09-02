/**
 * Team Management roster must exclude soft-deleted employees (list + pending count).
 * Run: npm --prefix backend run test:staff-roster-excludes-deleted
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "..");
const repoRoot = path.resolve(backendRoot, "..");

function readBackend(rel: string): string {
  return readFileSync(path.join(backendRoot, rel), "utf8");
}

function readRepo(rel: string): string {
  return readFileSync(path.join(repoRoot, rel), "utf8");
}

const businessService = readBackend("src/services/business.service.ts");
const tipChart = readBackend("src/utils/tipChartBuckets.ts");
const employeeService = readBackend("src/services/employee.service.ts");
const employeeController = readBackend("src/controllers/employee.controller.ts");
const staffPage = readRepo("src/app/pages/business/StaffManagementPage.tsx");

if (
  businessService.includes("const STAFF_ROSTER_EMPLOYEE_WHERE = { isDeleted: false }") &&
  (businessService.match(/where: \{ businessId, \.\.\.STAFF_ROSTER_EMPLOYEE_WHERE \}/g) ?? []).length >= 3
) {
  pass("loadBusinessAnalyticsEmployees findMany paths exclude isDeleted");
} else {
  fail("Roster employee findMany must filter isDeleted: false");
}

const rosterSqlDeletedFilters = (businessService.match(/e\.is_deleted = false/g) ?? []).length;
if (rosterSqlDeletedFilters >= 3) {
  pass("Dashboard roster SQL counts exclude soft-deleted employees");
} else {
  fail(`business.service roster SQL is_deleted filters: ${rosterSqlDeletedFilters}`);
}

const chartRosterDeleted = (tipChart.match(/e\.is_deleted = false/g) ?? []).length;
if (chartRosterDeleted >= 2) {
  pass("tipChartBuckets roster aggregates exclude is_deleted");
} else {
  fail("tipChartBuckets roster queries must filter is_deleted = false");
}

if (
  employeeService.includes("export async function deleteEmployeeForBusiness") &&
  employeeService.includes("where: { id: employeeId, businessId, isDeleted: false }") &&
  employeeService.includes("isDeleted: true")
) {
  pass("deleteEmployeeForBusiness remains ownership-scoped soft-delete");
} else {
  fail("deleteEmployeeForBusiness ownership / soft-delete contract drifted");
}

if (
  employeeController.includes("getBusinessByUserId(userId)") &&
  employeeController.includes("Only business owners can remove employees") &&
  employeeController.includes("deleteEmployeeForBusiness(business.id, employeeId.trim())")
) {
  pass("Delete controller still requires the authenticated business owner");
} else {
  fail("employee.deleteEmployee authorization drifted");
}

if (staffPage.includes("prev.filter((e) => e.id !== removedId)")) {
  pass("Team Management removes the deleted employee from local list immediately");
} else {
  fail("StaffManagementPage must drop the deleted row from state after success");
}

if (
  staffPage.includes("pendingInviteCount") &&
  staffPage.includes('e.activationStatus === "pending_activation"') &&
  staffPage.includes("employees.filter")
) {
  pass("Pending password count is derived from the visible employee list");
} else {
  fail("pendingInviteCount must follow the team list, not a separate stale source");
}

if (staffPage.includes("invalidateStaffRosterCaches()") && staffPage.includes("fetchEmployees({ revalidate: true })")) {
  pass("After delete, roster caches are invalidated and the list is refetched");
} else {
  fail("Delete success path must invalidate + refetch roster");
}

const failed = results.filter((r) => r.startsWith("FAIL:"));
for (const line of results) console.log(line);
if (failed.length) {
  console.error(`\n${failed.length} staff-roster-excludes-deleted check(s) failed`);
  process.exit(1);
}
console.log("\nAll staff-roster-excludes-deleted checks passed");
