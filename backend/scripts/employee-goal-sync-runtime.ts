/**
 * Employee monthly/tip goal sync — mutation, mirror, cache, and financial-safety locks.
 * Run: npm run test:employee-goal-sync --prefix backend
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoalPeriod } from "@prisma/client";
import { selectMonthlyGoalMirrorAmount } from "../src/services/employeeMonthlyGoalMirror.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

function assertIncludes(haystack: string, needle: string, message: string): void {
  assert.ok(haystack.includes(needle), message);
}

function assertNotIncludes(haystack: string, needle: string, message: string): void {
  assert.ok(!haystack.includes(needle), message);
}

const now = new Date("2026-09-12T12:00:00.000Z");
const older = new Date("2026-09-01T12:00:00.000Z");

assert.equal(selectMonthlyGoalMirrorAmount([]), null);

assert.equal(
  selectMonthlyGoalMirrorAmount([
    { goalAmount: 1000, goalPeriod: GoalPeriod.weekly, updatedAt: now },
    { goalAmount: 500, goalPeriod: GoalPeriod.monthly, updatedAt: older },
  ]),
  500,
  "legacy monthly_goal mirror prefers the latest active monthly row over a newer weekly row",
);

assert.equal(
  selectMonthlyGoalMirrorAmount([
    { goalAmount: 750, goalPeriod: GoalPeriod.weekly, updatedAt: now },
    { goalAmount: 400, goalPeriod: GoalPeriod.daily, updatedAt: older },
  ]),
  750,
  "when no monthly row exists, mirror uses the latest active goal of any period",
);

assert.equal(
  selectMonthlyGoalMirrorAmount([{ goalAmount: "1000", goalPeriod: GoalPeriod.monthly, updatedAt: now }]),
  1000,
);

const goalService = read("src/services/goal.service.ts");
assertIncludes(goalService, "async function afterEmployeeGoalMutation", "afterEmployeeGoalMutation must exist");
assertIncludes(goalService, "employeeMonthlyGoalMirror", "mirror helper must stay Prisma-free for tests");
assertIncludes(goalService, "invalidateEmployeeGoalReadCaches", "mutations must drop Overview/Business goal caches");
assertIncludes(goalService, "emp-dash-summary-bundle", "summary bundle cache must be invalidated (it embeds goal progress)");
assertIncludes(goalService, "biz-employee-goals", "business employee-goals cache must be invalidated");
assertNotIncludes(
  goalService,
  "invalidateCacheKeyPrefix(`emp-account:",
  "goal mutations must not drop employee account/earnings caches",
);

const deleteMyGoalFn = goalService.slice(
  goalService.indexOf("export async function deleteMyGoal("),
  goalService.indexOf("export async function listEmployeeGoalsForBusiness"),
);
assertIncludes(deleteMyGoalFn, "prisma.employeeGoal.deleteMany", "deleteMyGoal removes active EmployeeGoal rows");
assert.ok(!/prisma\.transaction\.delete/.test(deleteMyGoalFn), "deleteMyGoal must not delete Transaction rows");
assert.ok(!/prisma\.tip\b/.test(deleteMyGoalFn), "deleteMyGoal must not touch Tip aliases");
assert.ok(!/employeeTipPayable\.delete/.test(deleteMyGoalFn), "deleteMyGoal must not delete payables");

const deleteByIdFn = goalService.slice(goalService.indexOf("export async function deleteMyGoalById("));
assertIncludes(deleteByIdFn, "prisma.employeeGoal.delete", "deleteMyGoalById hard-deletes the EmployeeGoal row");
assertIncludes(deleteByIdFn, "status: \"deleted\"", "delete-by-id must emit deleted so clients do not keep progress");
assert.ok(!/employeeTipPayable\.delete/.test(deleteByIdFn), "deleteById must not delete payables");

const updateFn = goalService.slice(
  goalService.indexOf("export async function updateMyGoal("),
  goalService.indexOf("export async function archiveMyGoal("),
);
assertIncludes(updateFn, "id: goalId, employeeId: emp.id", "goal updates are scoped to the authenticated employee");

const schema = read("prisma/schema.prisma");
const goalModelStart = schema.indexOf("model EmployeeGoal {");
const goalModelEnd = schema.indexOf("\n}", goalModelStart);
const goalModel = schema.slice(goalModelStart, goalModelEnd + 2);
assertIncludes(goalModel, "employee Employee @relation", "EmployeeGoal belongs to Employee");
assert.ok(!goalModel.includes("EmployeeTipPayable"), "EmployeeGoal has no payable relation");
assert.ok(!goalModel.includes("Transaction"), "EmployeeGoal has no Transaction relation");

const employeeSvc = read("src/services/employee.service.ts");
assertIncludes(employeeSvc, "applyEmployeeMonthlyGoalFromColumn", "profile/staff monthlyGoal writes must mutate employee_goals");

const controller = read("src/controllers/goal.controller.ts");
assertIncludes(controller, "const userId = req.user?.userId ?? req.user?.id", "goal identity comes from the session");
assert.ok(!/req\.body\?\.employeeId/.test(controller), "goal controllers must not trust client employeeId");

const routes = read("src/routes/goals.routes.ts");
assertIncludes(routes, "requireRole(Role.EMPLOYEE)", "/api/goals is employee-only");

console.log("employee-goal-sync-runtime: ok");
