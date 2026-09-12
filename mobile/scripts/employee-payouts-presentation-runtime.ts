/**
 * Runtime lock: Instant CTA visibility vs €30 floor uses backend reason/eligible,
 * never a client-computed fee or homemade eligibility.
 * Run: npx tsx scripts/employee-payouts-presentation-runtime.ts
 */
import assert from "node:assert/strict";
import {
  employeeInstantCtaEnabled,
  employeeInstantFeePercentLabel,
  employeeInstantShowCta,
  employeeInstantUiMode,
  employeeInstantVisibleForTipRouting,
  employeePayoutActivityKind,
  employeePayoutActivityShowsStatusPill,
  employeePayoutActivityTone,
  employeePayoutActivityTitleKey,
  employeePayoutActivityDestinationKey,
  employeePayoutShowConnectPrompt,
  employeePayoutShowSetupPrompt,
  isEmployeeBusinessDistributionMode,
} from "../features/employee/payouts/employeeInstantPayoutPresentation";
import { formatCentsEur, formatMaskedLast4 } from "../features/employee/payouts/payoutDisplay";
import { formatEur } from "../utils/format";

assert.equal(employeeInstantUiMode(null), "hidden");
assert.equal(employeeInstantUiMode({ eligible: false, reason: "not_connected" }), "hidden");
assert.equal(employeeInstantUiMode({ eligible: false, reason: "below_minimum" }), "threshold");
assert.equal(employeeInstantUiMode({ eligible: false, reason: "zero_balance" }), "threshold");
assert.equal(employeeInstantUiMode({ eligible: true, reason: "eligible" }), "ready");
assert.equal(employeeInstantUiMode({ eligible: false, reason: "no_instant_destination" }), "blocked");

assert.equal(employeeInstantShowCta("threshold"), true);
assert.equal(employeeInstantCtaEnabled("threshold"), false);
assert.equal(employeeInstantShowCta("ready"), true);
assert.equal(employeeInstantCtaEnabled("ready"), true);
assert.equal(employeeInstantShowCta("hidden"), false);

assert.equal(
  employeeInstantFeePercentLabel({ feeConfigured: true, platformFeeCents: 150, targetTotalFeeBps: 250 }),
  "2.5%",
);
assert.equal(
  employeeInstantFeePercentLabel({ feeConfigured: true, platformFeeCents: 150, targetTotalFeeBps: 244 }),
  null,
);
assert.equal(
  employeeInstantFeePercentLabel({ feeConfigured: false, platformFeeCents: 150, targetTotalFeeBps: 250 }),
  null,
);

assert.equal(employeePayoutActivityKind({ status: "transferred", disputedOpenCents: 0 }), "transferred");
assert.equal(employeePayoutActivityKind({ status: "destination_settled", disputedOpenCents: 0 }), "destination_routed");
assert.equal(employeePayoutActivityKind({ status: "transferred", disputedOpenCents: 1 }), "disputed");
assert.equal(employeePayoutActivityKind({ status: "held_business", disputedOpenCents: 0 }), "held_venue");
assert.equal(employeePayoutActivityKind({ status: "held_platform", disputedOpenCents: 0 }), "held");
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
    routingMode: "business_distribution",
  }),
  "destination_routed",
);
assert.equal(
  employeePayoutActivityKind({
    presentationKind: "held_venue",
    status: "held_platform",
    disputedOpenCents: 0,
  }),
  "held_venue",
);
assert.equal(employeePayoutActivityTitleKey("held_venue"), "employeePayouts.venueDistribution");
assert.equal(employeePayoutActivityTitleKey("held"), "employeePayouts.activityKindHeld");
assert.equal(employeePayoutActivityTitleKey("transferred"), "employeePayouts.caretipTransfer");
assert.equal(employeePayoutActivityDestinationKey("held_venue"), null);
assert.equal(employeePayoutActivityDestinationKey("held"), "employeePayouts.destHeld");
assert.equal(employeePayoutActivityDestinationKey("transferred"), "employeePayouts.destStripe");
assert.equal(employeePayoutActivityDestinationKey("destination_routed"), "employeePayouts.destStripe");
assert.equal(employeePayoutActivityShowsStatusPill("held_venue"), false);
assert.equal(employeePayoutActivityShowsStatusPill("held"), true);
assert.equal(employeePayoutActivityTone("held_venue"), "neutral");
assert.equal(employeePayoutActivityTone("held"), "warning");
assert.equal(isEmployeeBusinessDistributionMode("business_distribution"), true);
assert.equal(isEmployeeBusinessDistributionMode("direct_to_employee"), false);
assert.equal(isEmployeeBusinessDistributionMode(undefined), false);

assert.equal(employeePayoutShowConnectPrompt(false, "not_connected"), true);
assert.equal(employeePayoutShowConnectPrompt(true, "not_connected"), false);
assert.equal(employeePayoutShowConnectPrompt(true, "connected"), false);
assert.equal(employeePayoutShowSetupPrompt(false, "setup_required"), true);
assert.equal(employeePayoutShowSetupPrompt(true, "setup_required"), false);
assert.equal(employeeInstantVisibleForTipRouting(true, "ready"), true);
assert.equal(employeeInstantVisibleForTipRouting(true, "threshold"), false);
assert.equal(employeeInstantVisibleForTipRouting(false, "threshold"), true);

assert.equal(formatEur(60.03), "€60,03");
assert.equal(formatCentsEur(12258), "€122,58");
assert.equal(formatMaskedLast4("3000"), "•••• 3000");
assert.equal(formatMaskedLast4(null), null);

console.log("employee-payouts-presentation-runtime: ok");
