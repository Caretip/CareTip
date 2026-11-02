/**
 * Employee email deep links survive sign-in without becoming an open redirect.
 * Run: npm run test:auth-post-login-return
 */
import assert from "node:assert/strict";
import { resolvePostAuthTarget, type PostAuthRedirectUser } from "../src/app/lib/authRedirects";

const employee: PostAuthRedirectUser = { isVerified: true, role: "employee", hasCompletedOnboarding: true };
const business: PostAuthRedirectUser = { isVerified: true, role: "business", hasCompletedOnboarding: true };

assert.equal(resolvePostAuthTarget(employee, "/employee/tip-history"), "/employee/tip-history");
assert.equal(resolvePostAuthTarget(employee, "/employee/settings/notifications"), "/employee/settings/notifications");
assert.equal(resolvePostAuthTarget(employee, undefined), "/employee/dashboard");
assert.equal(resolvePostAuthTarget(employee, 42), "/employee/dashboard");

for (const hostile of [
  "https://evil.example/employee/tip-history",
  "//evil.example/employee/tip-history",
  "/employee//evil.example",
  "/employee/\\evil.example",
  "/employee/tip-history?next=https://evil.example",
  "/employee/../dashboard",
  "/platform-admin/dashboard",
  "/dashboard",
  "/employee/login",
  "javascript:alert(1)",
]) {
  assert.equal(resolvePostAuthTarget(employee, hostile), "/employee/dashboard", hostile);
}

assert.equal(resolvePostAuthTarget(business, "/employee/tip-history"), "/dashboard", "other roles keep their home");
assert.equal(
  resolvePostAuthTarget({ ...employee, isVerified: false }, "/employee/tip-history"),
  "/verify-email",
  "email verification still comes first",
);

console.log("auth-post-login-return-runtime: ok");
