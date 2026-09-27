/**
 * Employee analytics tip record — semantic mapping (earnings vs routing vs status).
 * Run: npx tsx src/app/lib/employeeAnalyticsTipRecordPresentation.runtime.ts
 */
import assert from "node:assert/strict";
import {
  employeeAnalyticsTipRecordEarningsEur,
  employeeAnalyticsTipRecordPayoutStatusI18nKey,
  employeeAnalyticsTipRecordPayoutStatusTone,
  employeeAnalyticsTipRecordRoutingDestination,
  employeeAnalyticsTipRecordRoutingI18nKey,
} from "./employeeAnalyticsTipRecordPresentation";

assert.equal(employeeAnalyticsTipRecordEarningsEur(11.62), 11.62);
assert.equal(employeeAnalyticsTipRecordEarningsEur(null), 0, "business-routed tips show €0 direct earnings");

assert.equal(
  employeeAnalyticsTipRecordRoutingDestination("business_distribution"),
  "business_distribution",
);
assert.equal(
  employeeAnalyticsTipRecordRoutingI18nKey("business_distribution"),
  "employee.analytics.routingDestination.business",
);
assert.equal(
  employeeAnalyticsTipRecordRoutingI18nKey("direct_to_employee"),
  "employee.analytics.routingDestination.stripe",
);

assert.equal(
  employeeAnalyticsTipRecordPayoutStatusI18nKey("paid_to_business"),
  "employee.analytics.payoutStatus.paid_to_business",
);
assert.equal(employeeAnalyticsTipRecordPayoutStatusTone("paid_to_business"), "success");
assert.equal(employeeAnalyticsTipRecordPayoutStatusTone("pending_release"), "warning");
assert.equal(employeeAnalyticsTipRecordPayoutStatusTone("release_failed"), "danger");

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const analyticsPage = readFileSync(
  path.join(root, "app/pages/employee/EmployeeAnalyticsPage.tsx"),
  "utf8",
);
assert.ok(
  !analyticsPage.includes("formatEarningsCell"),
  "EmployeeAnalyticsPage must use employeeAnalyticsTipRecordPresentation",
);
assert.ok(
  analyticsPage.includes("employeeAnalyticsTipRecordEarningsEur"),
  "earnings must be monetary",
);

console.log("employeeAnalyticsTipRecordPresentation.runtime: OK");
