/**
 * Presentation lock: venue-distribution payables are not pending CareTip payouts.
 * Run: npx tsx src/app/components/employee/employeePayoutActivityPresentation.runtime.ts
 */
import assert from "node:assert/strict";
import {
  employeePayoutActivityKind,
  employeePayoutActivityShowsStatusPill,
  employeePayoutActivityTone,
  isEmployeeBusinessDistributionMode,
} from "./employeePayoutActivityPresentation";

assert.equal(employeePayoutActivityKind({ status: "held_business", disputedOpenCents: 0 }), "held_venue");
assert.equal(employeePayoutActivityKind({ status: "held_platform", disputedOpenCents: 0 }), "held");
assert.equal(employeePayoutActivityKind({ status: "destination_settled", disputedOpenCents: 0 }), "destination_routed");
assert.equal(employeePayoutActivityKind({ status: "transferred", disputedOpenCents: 0 }), "transferred");
assert.equal(employeePayoutActivityShowsStatusPill("held_venue"), false);
assert.equal(employeePayoutActivityShowsStatusPill("held"), true);
assert.equal(employeePayoutActivityTone("held_venue"), "neutral");
assert.equal(employeePayoutActivityTone("held"), "warning");
assert.equal(isEmployeeBusinessDistributionMode("business_distribution"), true);
assert.equal(isEmployeeBusinessDistributionMode("direct_to_employee"), false);

console.log("employee-payout-activity-presentation: ok");
