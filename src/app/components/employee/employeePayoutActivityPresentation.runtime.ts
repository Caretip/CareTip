/**
 * Presentation lock: venue-distribution payables are not pending CareTip payouts, and a
 * business-recorded distribution is shown as such (never as a Stripe/bank payout).
 * Stripe Connect access does NOT depend on the Business routing mode (only copy differs).
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
  employeePayoutHeldBufferCents,
  employeePayoutPrimaryCta,
  employeePayoutShowAccountSection,
  employeePayoutShowPrimaryStripeCta,
  employeePayoutUiPhase,
  employeeStripeConnectPromptActive,
} from "./employeePayoutAccountPresentation";
import {
  employeeTipActivityDistributionNote,
  employeeTipActivityPrimaryAmountCents,
  TIP_ACTIVITY_FILTERS,
} from "../../lib/employeeTipActivityPresentation";
import type { EmployeePayableActivityItem } from "../../lib/api";
import { employeeInstantUiMode, employeeInstantVisibleForTipRouting } from "./employeeInstantPayoutPresentation";
import { employeePayoutMetricsMode } from "./employeePayoutMetricsPresentation";
import { businessPayoutMetricsMode } from "../business/settings/billing/businessPayoutMetricsPresentation";

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

// Requirement 3 — Connect entry point is identical in both routing modes.
for (const businessDistribution of [false, true]) {
  for (const phase of [notConnected, incomplete, ready, "attention" as const]) {
    assert.equal(employeePayoutShowAccountSection(businessDistribution, phase), true, `section ${businessDistribution} ${phase}`);
    assert.equal(employeePayoutShowPrimaryStripeCta(businessDistribution, phase), true, `cta ${businessDistribution} ${phase}`);
  }
}
assert.equal(employeePayoutPrimaryCta(incomplete), "complete");
assert.equal(employeePayoutPrimaryCta("attention"), "complete");
assert.equal(employeePayoutPrimaryCta(ready), "update");
// Venue mode only changes the explanation, never hides it.
assert.equal(employeePayoutAccountBodyKey(true, notConnected, "not_connected"), "employee.payouts.businessMode.notConnectedBody");
assert.equal(employeePayoutAccountBodyKey(true, incomplete, "setup_required"), "employee.payouts.businessMode.incompleteBody");
assert.equal(employeePayoutAccountBodyKey(true, "attention", "restricted"), "employee.payouts.attentionBody");
assert.equal(employeePayoutAccountBodyKey(true, ready, "connected"), "employee.payouts.businessMode.readyBody");
assert.equal(employeePayoutAccountBodyKey(false, "attention", "restricted"), "employee.payouts.attentionBody");
assert.equal(employeePayoutUiPhase({
  loading: false,
  error: null,
  data: {
    connectionState: "restricted",
    stripeConfigured: true,
    hasAccount: true,
    detailsSubmitted: true,
    payoutsEnabled: false,
    canOpenDashboard: true,
    updatedAt: null,
  },
}), "attention");
// Connected-but-payouts-disabled is never "ready" (eligibility is Stripe-authoritative).
assert.equal(employeePayoutUiPhase({
  loading: false,
  error: null,
  data: {
    connectionState: "connected",
    stripeConfigured: true,
    hasAccount: true,
    detailsSubmitted: true,
    payoutsEnabled: false,
    canOpenDashboard: true,
    updatedAt: null,
  },
}), "setup_incomplete");

// CareTip buffer messaging: shown while not ready, in either mode; never once ready.
assert.equal(employeePayoutHeldBufferCents({ heldPlatformCents: 1250 }, notConnected), 1250);
assert.equal(employeePayoutHeldBufferCents({ heldPlatformCents: 1250 }, incomplete), 1250);
assert.equal(employeePayoutHeldBufferCents({ heldPlatformCents: 1250 }, ready), 0);
assert.equal(employeePayoutHeldBufferCents({ heldPlatformCents: 0 }, notConnected), 0);
assert.equal(employeePayoutHeldBufferCents(null, notConnected), 0);

// Dashboard fix-prompt: direct mode always when not ready; venue mode only with a concrete reason.
const promptBase = {
  stripeConfigured: true,
  hasAccount: false,
  connectionState: "not_connected" as const,
  payoutsEnabled: false,
  heldPlatformCents: 0,
};
assert.equal(employeeStripeConnectPromptActive({ ...promptBase, employeeTipPayoutMode: "direct_to_employee" }), true);
assert.equal(employeeStripeConnectPromptActive({ ...promptBase, employeeTipPayoutMode: "business_distribution" }), false);
assert.equal(
  employeeStripeConnectPromptActive({ ...promptBase, heldPlatformCents: 500, employeeTipPayoutMode: "business_distribution" }),
  true,
  "held buffer must prompt even when the venue distributes",
);
assert.equal(
  employeeStripeConnectPromptActive({
    ...promptBase,
    hasAccount: true,
    connectionState: "setup_required",
    employeeTipPayoutMode: "business_distribution",
  }),
  true,
  "started onboarding must be resumable from the dashboard",
);
assert.equal(
  employeeStripeConnectPromptActive({
    ...promptBase,
    hasAccount: true,
    connectionState: "connected",
    payoutsEnabled: true,
    employeeTipPayoutMode: "business_distribution",
  }),
  false,
);
assert.equal(employeeStripeConnectPromptActive({ ...promptBase, stripeConfigured: false }), false);

// Requirement 2 — business-recorded distribution on the employee's Tip Activity.
const venueRow: EmployeePayableActivityItem = {
  id: "p1",
  createdAt: "2026-11-01T10:00:00.000Z",
  activityAt: "2026-11-03T10:00:00.000Z",
  status: "held_business",
  routingMode: "business_distribution",
  chargeModel: "destination_business",
  presentationKind: "venue_distributed",
  grossCents: 1000,
  platformFeeCents: 100,
  payableCents: 900,
  transferredCents: 0,
  reversedCents: 0,
  refundedCents: 0,
  remainingPayableCents: 900,
  disputedOpenCents: 0,
  disputedLostCents: 0,
  activityCents: 900,
  distributedCents: 900,
  distributionState: "distributed",
  lastDistributedAt: "2026-11-03T10:00:00.000Z",
  businessName: "Cafe",
};
assert.equal(employeePayoutActivityKind(venueRow), "venue_distributed");
assert.equal(employeeTipActivityPrimaryAmountCents(venueRow), 900);
assert.deepEqual(employeeTipActivityDistributionNote(venueRow), {
  key: "employee.tipActivity.distribution.full",
  distributedCents: 900,
  outstandingCents: 0,
  at: "2026-11-03T10:00:00.000Z",
});
const partialRow = { ...venueRow, distributedCents: 400, activityCents: 400, distributionState: "partial" as const };
assert.deepEqual(employeeTipActivityDistributionNote(partialRow), {
  key: "employee.tipActivity.distribution.partial",
  distributedCents: 400,
  outstandingCents: 500,
  at: "2026-11-03T10:00:00.000Z",
});
assert.equal(employeeTipActivityDistributionNote({ ...venueRow, distributedCents: 0 }), null);
// Fallback derivation (older API without presentationKind) still honours allocations.
assert.equal(
  employeePayoutActivityKind({ status: "held_business", disputedOpenCents: 0, distributedCents: 1 }),
  "venue_distributed",
);
assert.equal(employeePayoutActivityKind({ status: "held_business", disputedOpenCents: 0, distributedCents: 0 }), "held_venue");
// Refund after distribution: refund wins the kind; the recorded distribution stays visible as history.
const refundedAfter = { ...venueRow, status: "refunded" as const, presentationKind: "refunded" as const };
assert.equal(employeePayoutActivityKind(refundedAfter), "refunded");
assert.ok(employeeTipActivityDistributionNote(refundedAfter));
// Distribution is never presented as a Stripe transfer / bank payout.
assert.notEqual(employeePayoutActivityKind(venueRow), "transferred");
assert.notEqual(employeePayoutActivityKind(venueRow), "destination_routed");
assert.equal(employeePayoutActivityTone("venue_distributed"), "success");
assert.equal(employeePayoutActivityShowsStatusPill("venue_distributed"), true);
assert.ok(TIP_ACTIVITY_FILTERS.includes("distributed"));

assert.equal(employeeInstantVisibleForTipRouting(false, "hidden"), false);
assert.equal(employeeInstantVisibleForTipRouting(false, "ready"), true);
assert.equal(employeeInstantVisibleForTipRouting(false, "threshold"), true);
assert.equal(employeeInstantVisibleForTipRouting(true, "ready"), true);
assert.equal(employeeInstantVisibleForTipRouting(true, "threshold"), false);
assert.equal(employeeInstantVisibleForTipRouting(true, "hidden"), false);
assert.equal(employeeInstantUiMode({ eligible: false, reason: "not_connected" }), "hidden");

assert.equal(employeePayoutMetricsMode({ loading: true, businessDistribution: false, connected: false }), "loading");
assert.equal(employeePayoutMetricsMode({ loading: false, businessDistribution: false, connected: false }), "setup");
assert.equal(employeePayoutMetricsMode({ loading: false, businessDistribution: true, connected: false }), "hidden");
assert.equal(employeePayoutMetricsMode({ loading: false, businessDistribution: false, connected: true }), "metrics");
assert.equal(employeePayoutMetricsMode({ loading: false, businessDistribution: true, connected: true }), "metrics");

assert.equal(businessPayoutMetricsMode({ loading: true, eligibility: null }), "loading");
assert.equal(businessPayoutMetricsMode({ loading: false, eligibility: null }), "unavailable");
assert.equal(businessPayoutMetricsMode({ loading: false, eligibility: { connected: false } }), "setup");
assert.equal(businessPayoutMetricsMode({ loading: false, eligibility: { connected: true } }), "metrics");

console.log("employee-payout-activity-presentation: ok");
