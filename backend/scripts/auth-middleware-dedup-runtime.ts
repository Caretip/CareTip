/**
 * Auth middleware deduplication regression — structure + guard behavior contracts.
 * Run: npm run test:auth-middleware-dedup --prefix backend
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const authMiddleware = read("src/middleware/auth.middleware.ts");
const onboardingMiddleware = read("src/middleware/requireCompletedOnboarding.middleware.ts");

assertIncludes(authMiddleware, "export type AuthenticatedUserRow", "authUser row type exported");
assertIncludes(authMiddleware, "authUser?: AuthenticatedUserRow", "Express.Request.authUser typed");
assertIncludes(authMiddleware, "req.authUser = userRow", "authMiddleware attaches authUser once");

const authHandler = authMiddleware.slice(
  authMiddleware.indexOf("export function authMiddleware"),
  authMiddleware.indexOf("export function requireRole"),
);
assertIncludes(authHandler, "loadAuthenticatedUser(payload.sub)", "single user load in authMiddleware");
assertIncludes(
  authHandler,
  "assertAccessJwtStillValid(payload, userRow)",
  "authMiddleware passes loaded user row into session validation",
);

const requireRoleFn = authMiddleware.slice(
  authMiddleware.indexOf("export function requireRole"),
  authMiddleware.indexOf("export function requireAdminRoleClaim"),
);
assertIncludes(requireRoleFn, "resolveAuthUserForRequest", "requireRole reuses cached authUser");
assertNotIncludes(
  requireRoleFn,
  "prisma.user.findUnique",
  "requireRole must not query user when authUser is present",
);

const requireVerifiedFn = authMiddleware.slice(
  authMiddleware.indexOf("export async function requireVerifiedEmail"),
  authMiddleware.indexOf("export async function requirePlatformAdmin"),
);
assertIncludes(requireVerifiedFn, "resolveAuthUserForRequest", "requireVerifiedEmail reuses authUser");
assertIncludes(requireVerifiedFn, "Email verification required", "unverified users still rejected");
assertNotIncludes(
  requireVerifiedFn,
  "prisma.user.findUnique",
  "requireVerifiedEmail must not query user when authUser is present",
);

const requirePlatformAdminFn = authMiddleware.slice(
  authMiddleware.indexOf("export async function requirePlatformAdmin"),
);
assertIncludes(requirePlatformAdminFn, "resolveAuthUserForRequest", "requirePlatformAdmin reuses authUser");
assertIncludes(requirePlatformAdminFn, "Insufficient permissions", "incorrect roles still rejected");

assertIncludes(onboardingMiddleware, "req.authUser", "onboarding middleware reads cached authUser");
assertIncludes(onboardingMiddleware, "ONBOARDING_INCOMPLETE", "onboarding restrictions still enforced");
assertIncludes(authMiddleware, "export function resolveRequestUserId", "JWT sub fallback exported for controllers");

const onboardingUserId = onboardingMiddleware.slice(
  onboardingMiddleware.indexOf("export async function requireCompletedOnboarding"),
  onboardingMiddleware.indexOf("let user = req.authUser"),
);
assertIncludes(onboardingUserId, "resolveRequestUserId(req)", "onboarding resolves user id from JWT sub");

const employeeService = read("src/services/employeeTipsDashboard.service.ts");
const loadSliceFn = employeeService.slice(
  employeeService.indexOf("async function loadEmployeeSqlBundleSlice"),
  employeeService.indexOf("function loadEmployeeSqlBundleSliceCached"),
);
assertIncludes(loadSliceFn, "Promise.all", "employee SQL bundle runs independent queries in parallel");

const tipsController = read("src/controllers/tips.controller.ts");
const summaryScopeFn = tipsController.slice(
  tipsController.indexOf('if (scope === "summary")'),
  tipsController.indexOf('if (scope === "analytics")'),
);
assertIncludes(summaryScopeFn, "Promise.all", "summary scope loads bundle + account summary in parallel");

console.log("auth-middleware-dedup-runtime: ok");
