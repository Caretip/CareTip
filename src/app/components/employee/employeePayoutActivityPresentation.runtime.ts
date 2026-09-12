/**
 * Presentation lock: venue-distribution payables are not pending CareTip payouts.
 * Employee Payments Connect communication is mutually exclusive by Business routing mode.
 * Run: npx tsx src/app/components/employee/employeePayoutActivityPresentation.runtime.ts
 */
import assert from "node:assert/strict";
import {
  employeePayoutActivityKind,
  employeePayoutActivityShowsStatusPill,
  employeePayoutActivityTone,
  isEmployeeBusinessDistributionMode,
} from "./employeePayoutActivityPresentation";
import {
  employeePayoutAccountBodyKey,
  employeePayoutPrimaryCta,
  employeePayoutShowAccountSection,
  employeePayoutShowPrimaryStripeCta,
  employeePayoutUiPhase,
} from "./employeePayoutAccountPresentation";
import { employeeInstantUiMode, employeeInstantVisibleForTipRouting } from "./employeeInstantPayoutPresentation";

assert.equal(employeePayoutActivityKind({ status: "held_business", disputedOpenCents: 0 }), "held_venue");
assert.equal(
  employeePayoutActivityKind({
    status: "held_platform",
    disputedOpenCents: 0,
    chargeModel: "destination_business",
    routingMode: "business_distribution",
  }),
  "held_venue",
);
assert.equal(
  employeePayoutActivityKind({
    status: "held_platform",
    disputedOpenCents: 0,
    chargeModel: "platform_hold",
    routingMode: "direct_to_employee",
  }),
  "held",
);
assert.equal(
  employeePayoutActivityKind({
    status: "destination_settled",
    disputedOpenCents: 0,
    chargeModel: "destination_employee",
    routingMode: "direct_to_employee",
  }),
  "destination_routed",
);
assert.equal(
  employeePayoutActivityKind({
    status: "held_business",
    disputedOpenCents: 0,
    chargeModel: "destination_business",
    routingMode: "business_distribution",
  }),
  "held_venue",
);
assert.equal(
  employeePayoutActivityKind({
    presentationKind: "held_venue",
    status: "held_platform",
    disputedOpenCents: 0,
  }),
  "held_venue",
);
assert.equal(employeePayoutActivityKind({ status: "held_platform", disputedOpenCents: 0 }), "held");
assert.equal(employeePayoutActivityKind({ status: "destination_settled", disputedOpenCents: 0 }), "destination_routed");
assert.equal(employeePayoutActivityKind({ status: "transferred", disputedOpenCents: 0 }), "transferred");
assert.equal(employeePayoutActivityShowsStatusPill("held_venue"), false);
assert.equal(employeePayoutActivityShowsStatusPill("held"), true);
assert.equal(employeePayoutActivityTone("held_venue"), "neutral");
assert.equal(employeePayoutActivityTone("held"), "warning");
assert.equal(isEmployeeBusinessDistributionMode("business_distribution"), true);
assert.equal(isEmployeeBusinessDistributionMode("direct_to_employee"), false);

const notConnected = employeePayoutUiPhase({
  loading: false,
  error: null,
  data: {
    connectionState: "not_connected",
    stripeConfigured: true,
    hasAccount: false,
    detailsSubmitted: false,
    payoutsEnabled: false,
    canOpenDashboard: false,
    updatedAt: null,
    employeeTipPayoutMode: "direct_to_employee",
  },
});
const ready = employeePayoutUiPhase({
  loading: false,
  error: null,
  data: {
    connectionState: "connected",
    stripeConfigured: true,
    hasAccount: true,
    detailsSubmitted: true,
    payoutsEnabled: true,
    canOpenDashboard: true,
    updatedAt: null,
    employeeTipPayoutMode: "direct_to_employee",
  },
});
const incomplete = employeePayoutUiPhase({
  loading: false,
  error: null,
  data: {
    connectionState: "setup_required",
    stripeConfigured: true,
    hasAccount: true,
    detailsSubmitted: false,
    payoutsEnabled: false,
    canOpenDashboard: true,
    updatedAt: null,
    employeeTipPayoutMode: "direct_to_employee",
  },
});

assert.equal(notConnected, "not_connected");
assert.equal(ready, "ready");
assert.equal(incomplete, "setup_incomplete");
assert.equal(employeePayoutPrimaryCta(notConnected), "connect");
assert.equal(employeePayoutShowAccountSection(false, notConnected), true);
assert.equal(employeePayoutShowPrimaryStripeCta(false, notConnected), true);
assert.equal(employeePayoutAccountBodyKey(false, notConnected, "not_connected"), "employee.payouts.notConnectedBody");
assert.equal(employeePayoutShowPrimaryStripeCta(false, ready), true);
assert.equal(employeePayoutShowPrimaryStripeCta(false, incomplete), true);

assert.equal(employeePayoutShowAccountSection(true, notConnected), false);
assert.equal(employeePayoutShowPrimaryStripeCta(true, notConnected), false);
assert.equal(employeePayoutAccountBodyKey(true, notConnected, "not_connected"), null);
assert.equal(employeePayoutShowAccountSection(true, ready), true);
assert.equal(employeePayoutShowPrimaryStripeCta(true, ready), true);
assert.equal(employeePayoutAccountBodyKey(true, ready, "connected"), null);
assert.equal(employeePayoutShowAccountSection(true, incomplete), true);
assert.equal(employeePayoutShowPrimaryStripeCta(true, incomplete), false);

assert.equal(employeeInstantVisibleForTipRouting(false, "hidden"), false);
assert.equal(employeeInstantVisibleForTipRouting(false, "ready"), true);
assert.equal(employeeInstantVisibleForTipRouting(false, "threshold"), true);
assert.equal(employeeInstantVisibleForTipRouting(true, "ready"), true);
assert.equal(employeeInstantVisibleForTipRouting(true, "threshold"), false);
assert.equal(employeeInstantVisibleForTipRouting(true, "hidden"), false);
assert.equal(employeeInstantUiMode({ eligible: false, reason: "not_connected" }), "hidden");

console.log("employee-payout-activity-presentation: ok");
