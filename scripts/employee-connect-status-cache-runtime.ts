/**
 * Employee Connect status — short-lived client cache + inflight dedupe.
 * Run: npm run test:employee-connect-status-cache
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function pass(msg: string) {
  console.log(`PASS: ${msg}`);
}

const api = readFileSync(path.join(root, "src/app/lib/api.ts"), "utf8");
assert.match(api, /EMPLOYEE_CONNECT_STATUS_CACHE_TTL_MS/);
assert.match(api, /employeeConnectStatusInflight/);
assert.match(api, /export function clearEmployeeConnectStatusClientCache/);
assert.match(api, /createEmployeeConnectAccountLink[\s\S]*clearEmployeeConnectStatusClientCache/);
pass("Connect status cache + invalidation on account-link");

const reset = readFileSync(path.join(root, "src/app/lib/resetAllClientSessionCaches.ts"), "utf8");
assert.match(reset, /clearEmployeeConnectStatusClientCache/);
pass("Logout clears Connect status cache");

const payoutCard = readFileSync(
  path.join(root, "src/app/components/employee/EmployeePayoutAccountCard.tsx"),
  "utf8",
);
assert.match(payoutCard, /clearEmployeeConnectStatusClientCache\(\)/);
pass("Stripe return path invalidates Connect status cache");

const analytics = readFileSync(path.join(root, "src/app/hooks/useEmployeeDashboardAnalytics.ts"), "utf8");
assert.match(analytics, /ensureChartAnalyticsLoaded/);
assert.match(analytics, /stopAfterSummary/);
assert.match(analytics, /chartAnalyticsRequestedRef/);
pass("Employee chart analytics deferred until chart idle mount");

const employeeDash = readFileSync(path.join(root, "src/app/pages/employee/EmployeeDashboard.tsx"), "utf8");
assert.match(employeeDash, /onReady=\{ensureChartAnalyticsLoaded\}/);
pass("Employee dashboard wires chart onReady to analytics loader");

console.log("\nEmployee connect + chart defer checks passed.");
