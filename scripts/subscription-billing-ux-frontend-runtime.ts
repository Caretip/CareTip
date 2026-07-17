/**
 * Commit 5 — Billing/pricing UX alignment runtime checks.
 * Run: npm run test:subscription-billing-ux-frontend
 */
import {
  buildCheckoutIntent,
  persistCheckoutIntentFromSearchParams,
  shouldIncludeTrialForIntent,
} from "../src/app/lib/checkoutIntent";
import {
  hasOperationalBillingPlan,
  isBillingTrialActive,
  isOnInternalBasicPlan,
  shouldShowTrialAlreadyUsedMessage,
  shouldShowTrialExpiredUpgrade,
} from "../src/app/lib/billingDisplayState";
import type { BillingStatus } from "../src/app/lib/api";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

function mockBilling(overrides: Partial<BillingStatus>): BillingStatus {
  return {
    planKey: "basic",
    billingCycle: "monthly",
    status: "active",
    trialStartedAt: null,
    trialEndsAt: null,
    isTrial: false,
    trialDaysRemaining: null,
    currentPeriodEnd: null,
    renewalDate: null,
    cancelAtPeriodEnd: false,
    cancellationEffective: null,
    hasStripeBilling: false,
    stripeCustomerId: null,
    subscriptionCreatedAt: "2026-01-01T00:00:00.000Z",
    syncedAt: "2026-01-01T00:00:00.000Z",
    subscriptionTier: "basic",
    billingEnabled: true,
    stripeConfigured: true,
    accessSource: "subscription",
    trialEligible: true,
    canStartTrial: true,
    trialUsed: false,
    trialPlanKey: null,
    lastTrialPlanKey: null,
    events: [],
    ...overrides,
  };
}

function testBasicOperational(): boolean {
  let ok = true;
  const basic = mockBilling({});
  if (!hasOperationalBillingPlan(basic)) {
    fail("basic user must have operational billing plan");
    ok = false;
  }
  if (!isOnInternalBasicPlan(basic)) {
    fail("basic user must be on internal basic plan");
    ok = false;
  }
  if (ok) pass("basic user is operational (not unsubscribed)");
  return ok;
}

function testTrialExpiredOnBasic(): boolean {
  let ok = true;
  const expired = mockBilling({
    trialUsed: true,
    trialEligible: false,
    lastTrialPlanKey: "premium",
    status: "active",
    planKey: "basic",
  });
  if (!shouldShowTrialExpiredUpgrade(expired)) {
    fail("expired pro trial on basic should show upgrade panel");
    ok = false;
  }
  if (!shouldShowTrialAlreadyUsedMessage(expired)) {
    fail("expired pro trial on basic should show already-used messaging");
    ok = false;
  }
  if (ok) pass("expired pro trial returns to basic upgrade state");
  return ok;
}

function testActiveProTrialDoesNotShowUsedMessage(): boolean {
  let ok = true;
  const activeTrial = mockBilling({
    planKey: "premium",
    status: "trialing",
    isTrial: true,
    trialUsed: false,
    trialEligible: false,
    trialDaysRemaining: 12,
    trialEndsAt: new Date(Date.now() + 12 * 24 * 60 * 60 * 1000).toISOString(),
    trialStartedAt: new Date(Date.now() - 16 * 24 * 60 * 60 * 1000).toISOString(),
    lastTrialPlanKey: "premium",
    trialPlanKey: "premium",
  });
  if (!isBillingTrialActive(activeTrial)) {
    fail("active pro trial must be detected as trial-active");
    ok = false;
  }
  if (shouldShowTrialExpiredUpgrade(activeTrial) || shouldShowTrialAlreadyUsedMessage(activeTrial)) {
    fail("active pro trial must not show trial-used / expired upgrade messaging");
    ok = false;
  }
  // Legacy DTO bug: trialUsed true while still trialing must still not show the nag.
  const legacyActive = mockBilling({
    ...activeTrial,
    trialUsed: true,
  });
  if (shouldShowTrialExpiredUpgrade(legacyActive) || shouldShowTrialAlreadyUsedMessage(legacyActive)) {
    fail("legacy trialUsed=true during active trial must not show used messaging");
    ok = false;
  }
  if (ok) pass("active pro trial keeps features messaging (no used nag)");
  return ok;
}

function testPaidProDoesNotShowUsedMessage(): boolean {
  let ok = true;
  const paidPro = mockBilling({
    planKey: "premium",
    status: "active",
    isTrial: false,
    trialUsed: false,
    trialEligible: false,
    lastTrialPlanKey: "premium",
  });
  if (shouldShowTrialAlreadyUsedMessage(paidPro) || shouldShowTrialExpiredUpgrade(paidPro)) {
    fail("paid pro must not show trial-used messaging");
    ok = false;
  }
  if (ok) pass("paid pro suppresses trial-used messaging");
  return ok;
}

function testCheckoutIntentBasicSkipped(): boolean {
  let ok = true;
  const params = new URLSearchParams("plan=starter&cycle=monthly");
  const saved = persistCheckoutIntentFromSearchParams(params);
  if (saved !== null) {
    fail("starter/basic signup must not persist checkout intent");
    ok = false;
  }
  const proTrial = buildCheckoutIntent({ marketingPlan: "business", billingCycle: "monthly", trial: true });
  if (proTrial.planKey !== "premium" || !shouldIncludeTrialForIntent(proTrial)) {
    fail("pro trial intent must map to premium with trial");
    ok = false;
  }
  if (ok) pass("checkout intent: basic skipped, pro trial maps to premium");
  return ok;
}

function main(): void {
  const checks = [
    testBasicOperational(),
    testTrialExpiredOnBasic(),
    testActiveProTrialDoesNotShowUsedMessage(),
    testPaidProDoesNotShowUsedMessage(),
    testCheckoutIntentBasicSkipped(),
  ];
  console.log(results.join("\n"));
  if (checks.some((c) => !c)) {
    console.error(`\n${checks.filter((c) => !c).length} check group(s) failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${checks.length} billing UX check groups passed.`);
}

main();
