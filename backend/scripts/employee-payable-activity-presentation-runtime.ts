/**
 * Frozen payable presentation — no DB, no current Connect/mode.
 * Run: npx tsx scripts/employee-payable-activity-presentation-runtime.ts
 */
import assert from "node:assert/strict";
import { employeePayablePresentationKind } from "../src/services/employeePayableActivityPresentation.js";

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
