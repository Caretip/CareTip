/**
 * Regression: mobile entitlement scope + Premium gates + error taxonomy contract.
 *
 * Run from repo root:
 *   npx tsx mobile/scripts/business-stats-scope-regression.ts
 *
 * Note: error helpers use `@/` aliases — classifiers are mirrored here for tsx.
 * Keep in sync with mobile/utils/userFacingError.ts.
 */
import assert from "node:assert/strict";
import {
  isPremiumAnalyticsTier,
  resolveAnalyticsStatsScope,
  resolveDashboardStatsScope,
} from "../utils/businessStatsScope";

function axiosLike(status: number, code?: string, message?: string) {
  return {
    response: {
      status,
      data: { code, message },
    },
  };
}

function codeOf(error: ReturnType<typeof axiosLike>): string | undefined {
  return error.response.data.code;
}

function messageOf(error: ReturnType<typeof axiosLike>): string {
  return error.response.data.message ?? "";
}

function isSubscriptionRequiredError(error: ReturnType<typeof axiosLike>): boolean {
  if (codeOf(error) === "SUBSCRIPTION_REQUIRED") return true;
  if (codeOf(error) === "PLAN_LIMIT_EXCEEDED") return true;
  return /subscription is required|plan limit/i.test(messageOf(error));
}

function isOnboardingIncompleteError(error: ReturnType<typeof axiosLike>): boolean {
  if (codeOf(error) === "ONBOARDING_INCOMPLETE") return true;
  return /complete onboarding/i.test(messageOf(error));
}

function isAuthenticationError(error: ReturnType<typeof axiosLike>): boolean {
  if (error.response.status === 401) return true;
  if (codeOf(error) === "AUTH_REQUIRED") return true;
  return /authentication required/i.test(messageOf(error));
}

function isPermissionError(error: ReturnType<typeof axiosLike>): boolean {
  if (isSubscriptionRequiredError(error)) return false;
  if (isOnboardingIncompleteError(error)) return false;
  if (isAuthenticationError(error)) return false;
  if (error.response.status === 403) return true;
  return messageOf(error) === "Insufficient permissions";
}

function run() {
  assert.equal(resolveDashboardStatsScope(undefined), "summary");
  assert.equal(resolveDashboardStatsScope("basic"), "summary");
  assert.equal(resolveDashboardStatsScope("premium"), "full");
  assert.equal(resolveDashboardStatsScope("enterprise"), "full");

  assert.equal(resolveAnalyticsStatsScope("basic"), "summary");
  assert.equal(resolveAnalyticsStatsScope("premium"), "full");
  assert.equal(resolveAnalyticsStatsScope("enterprise"), "full");

  assert.equal(isPremiumAnalyticsTier("basic"), false);
  assert.equal(isPremiumAnalyticsTier("premium"), true);

  const sub = axiosLike(403, "SUBSCRIPTION_REQUIRED", "An active subscription is required");
  const onboard = axiosLike(403, "ONBOARDING_INCOMPLETE", "Complete onboarding before accessing");
  const auth = axiosLike(401, "AUTH_REQUIRED", "Authentication required");
  const perm = axiosLike(403, undefined, "Insufficient permissions");

  assert.equal(isSubscriptionRequiredError(sub), true);
  assert.equal(isPermissionError(sub), false);
  assert.equal(isOnboardingIncompleteError(onboard), true);
  assert.equal(isPermissionError(onboard), false);
  assert.equal(isAuthenticationError(auth), true);
  assert.equal(isPermissionError(auth), false);
  assert.equal(isPermissionError(perm), true);
  assert.equal(isSubscriptionRequiredError(perm), false);

  console.log("business-stats-scope-regression: OK");
}

run();
