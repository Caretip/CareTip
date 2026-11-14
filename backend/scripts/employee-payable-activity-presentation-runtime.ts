/**
 * Frozen payable presentation — no DB, no current Connect/mode.
 * Run: npx tsx scripts/employee-payable-activity-presentation-runtime.ts
 */
import assert from "node:assert/strict";
import {
  employeePayableDistributionState,
  employeePayablePresentationKind,
} from "../src/services/employeePayableActivityPresentation.js";

// Business-recorded distribution (allocations) → venue_distributed; never a transfer kind.
const venue = {
  status: "held_business",
  disputedOpenCents: 0,
  chargeModel: "destination_business",
  routingMode: "business_distribution",
};
assert.equal(employeePayablePresentationKind({ ...venue, distributedCents: 0 }), "held_venue");
assert.equal(employeePayablePresentationKind({ ...venue, distributedCents: 500 }), "venue_distributed");
assert.equal(employeePayablePresentationKind({ ...venue, status: "refunded", distributedCents: 500 }), "refunded");
assert.equal(employeePayablePresentationKind({ ...venue, disputedOpenCents: 100, distributedCents: 500 }), "disputed");
// Allocations never relabel direct-routed rows.
assert.equal(
  employeePayablePresentationKind({
    status: "held_platform",
    disputedOpenCents: 0,
    chargeModel: "platform_hold",
    routingMode: "direct_to_employee",
    distributedCents: 500,
  }),
  "held",
);
assert.equal(employeePayableDistributionState({ ...venue, obligationCents: 900, distributedCents: 0 }), "awaiting");
assert.equal(employeePayableDistributionState({ ...venue, obligationCents: 900, distributedCents: 400 }), "partial");
assert.equal(employeePayableDistributionState({ ...venue, obligationCents: 900, distributedCents: 900 }), "distributed");
// Refunded after distribution: obligation dropped below what was recorded — still "distributed".
assert.equal(employeePayableDistributionState({ ...venue, obligationCents: 0, distributedCents: 900 }), "distributed");
assert.equal(employeePayableDistributionState({ ...venue, obligationCents: 0, distributedCents: 0 }), "not_applicable");
assert.equal(
  employeePayableDistributionState({
    status: "held_platform",
    chargeModel: "platform_hold",
    routingMode: "direct_to_employee",
    obligationCents: 900,
    distributedCents: 0,
  }),
  "not_applicable",
);

assert.equal(
  employeePayablePresentationKind({
    status: "destination_settled",
    disputedOpenCents: 0,
    chargeModel: "destination_employee",
    routingMode: "direct_to_employee",
  }),
  "destination_routed",
);

assert.equal(
  employeePayablePresentationKind({
    status: "held_platform",
    disputedOpenCents: 0,
    chargeModel: "platform_hold",
    routingMode: "direct_to_employee",
  }),
  "held",
);

assert.equal(
  employeePayablePresentationKind({
    status: "held_business",
    disputedOpenCents: 0,
    chargeModel: "destination_business",
    routingMode: "business_distribution",
  }),
  "held_venue",
);

assert.equal(
  employeePayablePresentationKind({
    status: "held_platform",
    disputedOpenCents: 0,
    chargeModel: "destination_business",
    routingMode: "business_distribution",
  }),
  "held_venue",
);

assert.equal(
  employeePayablePresentationKind({
    status: "transferred",
    disputedOpenCents: 0,
    chargeModel: "platform_hold",
    routingMode: "direct_to_employee",
  }),
  "transferred",
);

assert.equal(
  employeePayablePresentationKind({
    status: "destination_settled",
    disputedOpenCents: 0,
    chargeModel: "destination_employee",
    routingMode: "direct_to_employee",
  }),
  "destination_routed",
);

assert.equal(
  employeePayablePresentationKind({
    status: "held_business",
    disputedOpenCents: 0,
    chargeModel: "destination_business",
    routingMode: "direct_to_employee",
  }),
  "held_venue",
);

assert.equal(
  employeePayablePresentationKind({
    status: "destination_settled",
    disputedOpenCents: 0,
    chargeModel: "destination_employee",
    routingMode: "business_distribution",
  }),
  "destination_routed",
);

assert.equal(
  employeePayablePresentationKind({
    status: "transferred",
    disputedOpenCents: 0,
    chargeModel: "platform_hold",
    routingMode: "direct_to_employee",
  }),
  "transferred",
);

console.log("employee-payable-activity-presentation: ok");
