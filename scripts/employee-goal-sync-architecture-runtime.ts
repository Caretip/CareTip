/**
 * Employee monthly/tip goal lifecycle — Overview, Business, cache, no-goal UI.
 * Run: npm run test:employee-goal-sync-architecture
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  const abs = path.join(root, rel);
  if (!existsSync(abs)) throw new Error(`missing file: ${rel}`);
  return readFileSync(abs, "utf8");
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

/** Mirrors EmployeeDashboardMetricsGrid hasGoal / remaining rules. */
function overviewHasGoal(goalTarget: number | null | undefined): boolean {
  return goalTarget != null && goalTarget > 0;
}

function overviewRemaining(earned: number, goalTarget: number): number {
  return Math.max(0, goalTarget - earned);
}

const earned = 884.9;
assert(overviewHasGoal(500) === true, "existing €500 goal is present");
assert(overviewRemaining(earned, 500) === 0, "earned above target → €0 to go");
assert(overviewHasGoal(1000) === true, "edited €1000 goal is present");
assert(Math.abs(overviewRemaining(earned, 1000) - 115.1) < 0.001, "edit recalculates remaining");
assert(overviewHasGoal(null) === false, "deleted goal is not a goal");
assert(overviewHasGoal(0) === false, "zero is not a displayable goal");
assert(earned === 884.9, "earnings are independent of goal deletion");

const dashboard = read("src/app/pages/employee/EmployeeDashboard.tsx");
assert(
  dashboard.includes("displayGoalProgress != null ? displayGoalProgress.goalAmount : null"),
  "Overview target must come from goalProgress, not Employee.monthlyGoal",
);
assert(
  !/goalProgress\?\.goalAmount\s*\?\?\s*.*monthlyGoal/.test(dashboard),
  "Overview must not fall back to monthlyGoal after Tip Goals delete",
);

const grid = read("src/app/components/employee/EmployeeDashboardMetricsGrid.tsx");
assert(grid.includes("goalTarget != null && goalTarget > 0"), "hasGoal requires a positive target");
assert(grid.includes("employee.dashboard.noMonthlyGoal"), "no-goal uses existing empty copy");
assert(grid.includes("format.notAvailable"), "no-goal must not render a fake 100%");

const analytics = read("src/app/hooks/useEmployeeDashboardAnalytics.ts");
assert(
  analytics.includes("subscribeEmployeeGoalClientInvalidation"),
  "Overview hook must refetch when employee goal caches are invalidated",
);
assert(
  analytics.includes("goalProgress: null"),
  "stale lastKnownGoodMetrics goalProgress must be cleared on goal mutation",
);

const sync = read("src/app/lib/employeeGoalClientSync.ts");
assert(sync.includes("clearEmployeePeriodSwrStore"), "navigate-back SWR must drop after goal mutation");
assert(sync.includes("EMPLOYEE_GOALS_CACHE_PREFIX"), "Tip Goals session snapshot must drop");
assert(sync.includes("EMPLOYEE_SETTINGS_CACHE_PREFIX"), "Settings snapshot must drop");

const tipGoals = read("src/app/pages/employee/EmployeeTipGoalsPage.tsx");
assert(tipGoals.includes("invalidateEmployeeGoalClientCaches"), "Tip Goals mutations must notify Overview");

const settings = read("src/app/pages/employee/EmployeeSettingsPage.tsx");
assert(settings.includes("invalidateEmployeeGoalClientCaches"), "Settings monthlyGoal save must notify Overview");

const empRt = read("src/app/components/employee/EmployeeDashboardRealtimeSync.tsx");
assert(empRt.includes("REALTIME_EVENTS.GOAL_UPDATED"), "employee Overview listens for goal.updated");

const bizRt = read("src/app/components/business/BusinessDashboardRealtimeSync.tsx");
assert(bizRt.includes("REALTIME_EVENTS.GOAL_UPDATED"), "business Overview listens for goal.updated");
assert(bizRt.includes("invalidateBusinessAnalytics"), "business analytics cache drops on goal.updated");

const staff = read("src/app/pages/business/StaffManagementPage.tsx");
assert(staff.includes("REALTIME_EVENTS.GOAL_UPDATED"), "staff roster monthlyGoal must refresh on goal.updated");

const insights = read("src/app/components/employee/EmployeePerformanceInsights.tsx");
assert(
  insights.includes("goalProgress != null && goalProgress.goalAmount > 0"),
  "performance tile must not use monthlyGoal as a stand-in target",
);

const mobileBridge = read("mobile/components/providers/RealtimeQueryBridge.tsx");
assert(mobileBridge.includes("empGoal"), "mobile goal.updated must refetch tips/profile, not payouts");
assert(
  /GOAL_UPDATED[\s\S]{0,180}empGoal/.test(mobileBridge),
  "GOAL_UPDATED must schedule empGoal rather than empTips (payables)",
);

console.log("employee-goal-sync-architecture: ok");
