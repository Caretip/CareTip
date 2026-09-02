/**
 * Employee dashboard session cache: overview period snapshot, assignment,
 * tip history, goals, settings, inbox remount paint, logout wipe.
 * Run: npm run test:employee-page-session
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EmployeeGoalRow, EmployeeSelfAssignment, TipActivityRow } from "../src/app/lib/api";
import {
  clearEmployeePageSessionCache,
  employeeAssignmentCacheKey,
  employeeGoalsCacheKey,
  employeeSettingsCacheKey,
  employeeTipsHistoryDefaultCacheKey,
  readEmployeeAssignmentSnapshot,
  readEmployeeGoalsSnapshot,
  readEmployeeSettingsSnapshot,
  readEmployeeTipsHistorySnapshot,
  writeEmployeeAssignmentSnapshot,
  writeEmployeeGoalsSnapshot,
  writeEmployeeSettingsSnapshot,
} from "../src/app/lib/employeePageSessionCache";
import {
  clearEmployeePeriodSwrStore,
  getEmployeePeriodLastTimeframe,
  isEmployeePeriodLiveSettled,
  peekEmployeePeriodSnapshot,
  writeEmployeePeriodSnapshot,
} from "../src/app/lib/employeePeriodSessionCache";
import { peekInboxSessionCache, writeInboxSessionCache } from "../src/app/lib/notificationInboxCache";
import { setPageSessionCache } from "../src/app/lib/pageSessionCache";
import { resetAllClientSessionCaches } from "../src/app/lib/resetAllClientSessionCaches";
import { deriveDashboardMetricLoading } from "../src/app/lib/dashboardHydration";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

const root = path.dirname(fileURLToPath(new URL(".", import.meta.url)));

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

function sampleAssignment(name: string): EmployeeSelfAssignment {
  return {
    location: { id: `loc-${name}`, name: `${name} Bar`, description: null },
    tables: [{ id: `tbl-${name}`, name: "T1", location: { id: `loc-${name}`, name: `${name} Bar` } }],
  };
}

function sampleGoal(name: string): EmployeeGoalRow {
  return {
    id: `goal-${name}`,
    name: `${name} goal`,
    goalAmount: 500,
    goalPeriod: "monthly",
    status: "active",
    startDate: "2026-09-01",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
}

function sampleTip(name: string): TipActivityRow {
  return {
    id: `tip-${name}`,
    amount: 5,
    status: "success",
    createdAt: "2026-09-01T12:00:00.000Z",
    employeeId: `emp-${name}`,
    locationId: null,
    tableId: null,
    staffName: name,
    locationName: null,
    tableName: null,
  };
}

clearEmployeePageSessionCache();
clearEmployeePeriodSwrStore();

if (employeeAssignmentCacheKey("emp-a") === "employee:assignment:emp-a") {
  pass("Assignment cache key is prefixed and user-scoped");
} else {
  fail("employeeAssignmentCacheKey drifted");
}

if (employeeGoalsCacheKey("emp-a") === "employee:goals:emp-a") {
  pass("Goals cache key is prefixed and user-scoped");
} else {
  fail("employeeGoalsCacheKey drifted");
}

if (employeeSettingsCacheKey("emp-a") === "employee:settings:emp-a") {
  pass("Settings cache key is prefixed and user-scoped");
} else {
  fail("employeeSettingsCacheKey drifted");
}

if (
  employeeTipsHistoryDefaultCacheKey("emp-a", "employee") ===
  "tips-activity:employee-history:emp-a:employee:all:month:0:::"
) {
  pass("Tip History default cache key matches list filters for remount");
} else {
  fail("employeeTipsHistoryDefaultCacheKey drifted");
}

writeEmployeeAssignmentSnapshot("emp-a", sampleAssignment("Alpha"));
writeEmployeeAssignmentSnapshot("emp-b", sampleAssignment("Beta"));

const assignA = readEmployeeAssignmentSnapshot("emp-a");
const assignB = readEmployeeAssignmentSnapshot("emp-b");

if (assignA?.location?.name === "Alpha Bar" && assignB?.location?.name === "Beta Bar") {
  pass("Assignment snapshots are isolated per employee");
} else {
  fail("Assignment snapshot isolation failed");
}

writeEmployeeGoalsSnapshot("emp-a", [sampleGoal("Alpha")]);
writeEmployeeGoalsSnapshot("emp-b", [sampleGoal("Beta")]);

if (
  readEmployeeGoalsSnapshot("emp-a")?.[0]?.name === "Alpha goal" &&
  readEmployeeGoalsSnapshot("emp-b")?.[0]?.name === "Beta goal"
) {
  pass("Goals snapshots are isolated per employee");
} else {
  fail("Goals snapshot isolation failed");
}

writeEmployeeSettingsSnapshot("emp-a", {
  name: "Alpha",
  bio: "A",
  businessName: "Cafe A",
  monthlyGoal: "100",
  emailNotif: true,
  pushNotif: false,
});
writeEmployeeSettingsSnapshot("emp-b", {
  name: "Beta",
  bio: "B",
  businessName: "Cafe B",
  monthlyGoal: "200",
  emailNotif: false,
  pushNotif: true,
});

if (
  readEmployeeSettingsSnapshot("emp-a")?.businessName === "Cafe A" &&
  readEmployeeSettingsSnapshot("emp-b")?.name === "Beta"
) {
  pass("Settings snapshots are isolated per employee");
} else {
  fail("Settings snapshot isolation failed");
}

setPageSessionCache(employeeTipsHistoryDefaultCacheKey("emp-a", "employee"), {
  items: [sampleTip("Alpha")],
  total: 1,
  timezone: "Europe/Berlin",
});
setPageSessionCache(employeeTipsHistoryDefaultCacheKey("emp-b", "employee"), {
  items: [sampleTip("Beta")],
  total: 2,
  timezone: "Europe/Berlin",
});

if (
  readEmployeeTipsHistorySnapshot("emp-a", "employee")?.items[0]?.staffName === "Alpha" &&
  readEmployeeTipsHistorySnapshot("emp-b", "employee")?.total === 2
) {
  pass("Tip History snapshots survive a simulated remount");
} else {
  fail("Tip History snapshot remount failed");
}

writeInboxSessionCache("{}", {
  items: [{ id: "n1", title: "Hello", body: "", read: false } as never],
  unreadCount: 3,
  nextCursor: null,
});

if (peekInboxSessionCache("{}")?.unreadCount === 3) {
  pass("Inbox snapshot is readable after write (remount paint)");
} else {
  fail("Inbox snapshot missing");
}

writeEmployeePeriodSnapshot("week", {
  summary: { periodTipCount: 4, periodAmountEur: 20 },
  analytics: { chartSeries: [{ label: "Mon", amount: 5 }] },
  payload: {
    tips: [],
    monthlyGoal: 100,
    currentMonthTotal: 20,
    goalProgress: null,
    businessTimezone: "Europe/Berlin",
    periodTipCount: 4,
    periodAmountEur: 20,
    averageRating: null,
    ratingCount: 0,
    chartSeries: [{ label: "Mon", amount: 5 }],
  },
});

const periodPeek = peekEmployeePeriodSnapshot("week");
if (
  periodPeek &&
  (periodPeek.payload as { periodTipCount?: number }).periodTipCount === 4 &&
  isEmployeePeriodLiveSettled() &&
  getEmployeePeriodLastTimeframe() === "week"
) {
  pass("Overview period snapshot hydrates after simulated unmount");
} else {
  fail("Overview period snapshot missing after write");
}

if (peekEmployeePeriodSnapshot("today") == null) {
  pass("Unused overview timeframe has no snapshot");
} else {
  fail("Unused overview timeframe returned a snapshot");
}

resetAllClientSessionCaches();

if (
  readEmployeeAssignmentSnapshot("emp-a") == null &&
  readEmployeeGoalsSnapshot("emp-a") == null &&
  readEmployeeSettingsSnapshot("emp-a") == null &&
  readEmployeeTipsHistorySnapshot("emp-a", "employee") == null &&
  peekInboxSessionCache("{}") == null &&
  peekEmployeePeriodSnapshot("week") == null &&
  !isEmployeePeriodLiveSettled() &&
  getEmployeePeriodLastTimeframe() === "today"
) {
  pass("Logout wipe clears employee page + overview snapshots");
} else {
  fail("Logout wipe left employee session data");
}

const cacheMod = read("src/app/lib/employeePageSessionCache.ts");
const periodMod = read("src/app/lib/employeePeriodSessionCache.ts");
if (
  !cacheMod.includes("localStorage.setItem") &&
  !cacheMod.includes("window.localStorage") &&
  !periodMod.includes("localStorage.setItem") &&
  !periodMod.includes("window.localStorage")
) {
  pass("Employee session caches do not use localStorage");
} else {
  fail("Employee session cache wrote localStorage");
}

const assignmentPage = read("src/app/pages/employee/EmployeeAssignmentPage.tsx");
if (
  !assignmentPage.includes("clearEmployeeProfileClientCache") &&
  assignmentPage.includes("readEmployeeAssignmentSnapshot") &&
  assignmentPage.includes("useState(() => readAssignmentFromSession")
) {
  pass("Assignment hydrates from session snapshot and no longer clears profile cache on mount");
} else {
  fail("Assignment page still clears cache or skips sync hydrate");
}

const analytics = read("src/app/hooks/useEmployeeDashboardAnalytics.ts");
if (
  analytics.includes("peekEmployeePeriodSnapshot") &&
  analytics.includes("Keep period snapshots for sidebar remounts") &&
  !analytics.includes("employeePeriodSwrStore.clear()")
) {
  pass("Overview analytics keep period SWR across remount instead of wiping it");
} else {
  fail("Overview analytics still wipe period SWR on remount");
}

const overview = read("src/app/pages/employee/EmployeeDashboard.tsx");
if (
  overview.includes("const periodMetricsLoading = showMetricsSkeleton;") &&
  !overview.includes("showMetricsSkeleton || (!useDevDemo && !displayMetrics)")
) {
  pass("Period KPI skeleton is not latched on missing displayMetrics");
} else {
  fail("Employee overview still stays on skeleton until period toggle");
}

const waitingForEnable = deriveDashboardMetricLoading({
  enabled: false,
  hasMetricsData: false,
  valuesMatchPeriod: true,
  summaryLoading: false,
  isRevalidating: false,
});
const confirmedEmpty = deriveDashboardMetricLoading({
  enabled: true,
  hasMetricsData: true,
  valuesMatchPeriod: true,
  summaryLoading: false,
  isRevalidating: false,
});
if (waitingForEnable.showMetricsSkeleton && !confirmedEmpty.showMetricsSkeleton) {
  pass("Employee KPIs stay on skeleton until the dashboard is active, then show confirmed zeros");
} else {
  fail("Employee KPIs still paint default zeros before the initial period request");
}

if (
  analytics.includes("inflight_attach_error") &&
  analytics.includes("inflight_attach_incomplete") &&
  analytics.includes("needsInitialPeriodNetwork") &&
  analytics.includes('forceNetwork: needsInitialPeriodNetwork') &&
  analytics.includes("mount_load_start") &&
  !analytics.includes("window.setTimeout(() => {")
) {
  pass("Initial period analytics load on activate, and aborted inflight attaches retry instead of painting zeros");
} else {
  fail("Employee dashboard still skips or drops the initial period analytics load");
}

if (
  analytics.includes("inflight_attach_error") &&
  analytics.includes('forceNetwork: true') &&
  analytics.includes("loadForRef.current(tf")
) {
  pass("Failed inflight attach retries a fresh period load instead of clearing loading with no payload");
} else {
  fail("Inflight attach errors still leave period KPIs empty");
}

const inboxPage = read("src/app/pages/shared/NotificationInboxPage.tsx");
const inboxCss = read("src/styles/dashboard-workspace.css");
if (
  inboxPage.includes("flushSurface = isEmployee || isBusiness") &&
  inboxCss.includes("business-dashboard .dashboard-inbox-page--flush")
) {
  pass("Business inbox uses the same flush/full-width surface as employee inbox");
} else {
  fail("Business inbox is still carded or not flush to the page background");
}

const tipHistory = read("src/app/pages/shared/TipsActivityPage.tsx");
if (
  tipHistory.includes("readEmployeeTipsHistorySnapshot") &&
  tipHistory.includes("() => boot?.items ?? []")
) {
  pass("Tip History sync-inits list state from the session snapshot");
} else {
  fail("Tip History still starts empty then hydrates in an effect");
}

const goals = read("src/app/pages/employee/EmployeeTipGoalsPage.tsx");
if (
  goals.includes("readEmployeeGoalsSnapshot") &&
  goals.includes("() => boot ?? []")
) {
  pass("Tip Goals sync-inits from the session snapshot");
} else {
  fail("Tip Goals still starts empty then hydrates in an effect");
}

const settings = read("src/app/pages/employee/EmployeeSettingsPage.tsx");
if (
  settings.includes("readEmployeeSettingsSnapshot") &&
  settings.includes("useState(() => !boot)")
) {
  pass("Settings sync-inits from the session snapshot");
} else {
  fail("Settings still starts with a loading skeleton on remount");
}

const inboxHook = read("src/app/hooks/useNotifications.ts");
if (
  inboxHook.includes("peekInboxSessionCache") &&
  inboxHook.includes("useState<InboxNotification[]>(() =>")
) {
  pass("Inbox list hydrates synchronously from the session snapshot");
} else {
  fail("Inbox still starts empty on remount");
}

const reset = read("src/app/lib/resetAllClientSessionCaches.ts");
if (
  reset.includes("clearEmployeePageSessionCache") &&
  reset.includes("clearEmployeePeriodSwrStore")
) {
  pass("resetAllClientSessionCaches wipes employee page and overview snapshots");
} else {
  fail("Logout cache reset missing employee session clears");
}

const routes = read("src/app/routes.tsx");
if (
  routes.includes("pages/employee/EmployeeDashboard") &&
  routes.includes("path: 'assignment'") &&
  routes.includes("path: 'tip-history'") &&
  routes.includes("path: 'inbox'")
) {
  pass("Employee pages remain lazy child routes (components remount; data is cached)");
} else {
  fail("Employee routes drifted");
}

const failed = results.filter((r) => r.startsWith("FAIL:")).length;
console.log(results.join("\n"));
if (failed) {
  console.error(`\n${failed} employee-page-session check(s) failed`);
  process.exit(1);
}
console.log(`\n${results.length} employee-page-session checks passed`);
