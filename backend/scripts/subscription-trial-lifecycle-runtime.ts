/**
 * Commit 2 — Pro trial lifecycle from internal Basic.
 * Run: npm run test:subscription-trial-lifecycle
 */
import "dotenv/config";
import "../src/loadEnv.js";
import bcrypt from "bcrypt";
import { SubscriptionStatus } from "@prisma/client";
import { prisma } from "../src/prisma.js";
import {
  assertTrialCheckoutAllowed,
  isTrialPlanKeyEligibleForStripeTrial,
  resolveTrialEligibilityForBusiness,
} from "../src/services/trialEligibility.service.js";
import { getBillingStatusForBusiness } from "../src/services/managerBilling.service.js";
import { resolveSubscriptionEntitlements } from "../src/services/subscriptionEntitlement.service.js";
import {
  downgradeToInternalBasic,
  isInternalBasicSubscription,
  provisionInternalBasicSubscription,
} from "../src/services/subscription.service.js";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

function billingPrereqsOk(): boolean {
  const billing = process.env.SUBSCRIPTION_BILLING_ENABLED?.trim().toLowerCase();
  const billingOn =
    billing === "true" || billing === "1" || billing === "yes" || billing === "on";
  const stripeKey = Boolean(process.env.STRIPE_SECRET_KEY?.trim());
  const trialOff = process.env.SUBSCRIPTION_TRIAL_ENABLED?.trim().toLowerCase() === "false";
  return billingOn && stripeKey && !trialOff;
}

async function createManagerBusiness(tag: string, subscription?: {
  planKey: "basic" | "premium" | "enterprise";
  status: SubscriptionStatus;
  stripeSubscriptionId?: string | null;
  trialStartedAt?: Date;
  trialEndsAt?: Date;
  isTrial?: boolean;
}) {
  const passwordHash = await bcrypt.hash("TestPass1!", 10);
  const user = await prisma.user.create({
    data: {
      email: `${tag}@caretip-test.local`,
      passwordHash,
      role: "MANAGER",
      emailVerified: true,
      business: {
        create: {
          name: `${tag} venue`,
          slug: `${tag}-venue`,
          ...(subscription
            ? {
                subscriptionTier:
                  subscription.planKey === "basic"
                    ? "basic"
                    : subscription.planKey === "premium"
                      ? "premium"
                      : "enterprise",
                subscription: {
                  create: {
                    planKey: subscription.planKey,
                    status: subscription.status,
                    billingCycle: "monthly",
                    stripeSubscriptionId: subscription.stripeSubscriptionId ?? null,
                    stripePriceId: subscription.stripeSubscriptionId ? "price_test" : null,
                    trialStartedAt: subscription.trialStartedAt ?? null,
                    trialEndsAt: subscription.trialEndsAt ?? null,
                    isTrial: subscription.isTrial ?? subscription.status === "trialing",
                  },
                },
              }
            : {}),
        },
      },
    },
    include: { business: true },
  });

  const business = user.business;
  if (!business) throw new Error("business missing");

  if (!subscription) {
    await provisionInternalBasicSubscription(business.id, { source: "auto_heal" });
  }

  return business;
}

async function testProOnlyTrialPlanKey(): Promise<boolean> {
  if (isTrialPlanKeyEligibleForStripeTrial("premium")) {
    pass("Pro (premium) planKey eligible for Stripe trial");
  } else {
    fail("premium should be trial-eligible planKey");
    return false;
  }
  if (!isTrialPlanKeyEligibleForStripeTrial("basic")) {
    pass("Basic planKey rejected for Stripe trial");
    return true;
  }
  fail("basic must not be trial-eligible");
  return false;
}

async function testBasicUserCanStartProTrial(): Promise<boolean> {
  if (!billingPrereqsOk()) {
    pass("basic trial eligibility — SKIP (billing/stripe/trial env not fully enabled)");
    return true;
  }

  const tag = `c2-basic-eligible-${Date.now()}`;
  const business = await createManagerBusiness(tag);
  const eligibility = await resolveTrialEligibilityForBusiness(business.id);

  if (!eligibility.eligible || eligibility.reason !== "eligible") {
    fail(`basic user should be trial eligible, got reason=${eligibility.reason}`);
    return false;
  }

  try {
    await assertTrialCheckoutAllowed(business.id, "premium");
    pass("basic user passes assertTrialCheckoutAllowed for Pro");
  } catch (e) {
    fail(`assertTrialCheckoutAllowed failed: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }

  const billing = await getBillingStatusForBusiness(business.id);
  if (!billing.canStartTrial || !billing.trialEligible) {
    fail("billing DTO should expose canStartTrial=true for fresh Basic");
    return false;
  }

  pass("basic user can start Pro trial (eligibility + billing DTO)");
  return true;
}

async function testActiveProCannotStartTrial(): Promise<boolean> {
  const tag = `c2-pro-active-${Date.now()}`;
  const business = await createManagerBusiness(tag, {
    planKey: "premium",
    status: SubscriptionStatus.active,
    stripeSubscriptionId: `sub_${tag}`,
  });

  const eligibility = await resolveTrialEligibilityForBusiness(business.id);
  if (eligibility.eligible || eligibility.reason !== "active_pro") {
    fail(`active Pro should block trial, got reason=${eligibility.reason}`);
    return false;
  }

  pass("active Pro cannot start trial");
  return true;
}

async function testPremiumCannotStartTrial(): Promise<boolean> {
  const tag = `c2-premium-${Date.now()}`;
  const business = await createManagerBusiness(tag, {
    planKey: "enterprise",
    status: SubscriptionStatus.active,
    stripeSubscriptionId: `sub_${tag}`,
  });

  const eligibility = await resolveTrialEligibilityForBusiness(business.id);
  if (eligibility.eligible || eligibility.reason !== "premium") {
    fail(`Premium should block trial, got reason=${eligibility.reason}`);
    return false;
  }

  pass("Premium (enterprise) cannot start trial");
  return true;
}

async function testExpiredProTrialReturnsBasic(): Promise<boolean> {
  const tag = `c2-expired-${Date.now()}`;
  const trialStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const trialEnd = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  const business = await createManagerBusiness(tag, {
    planKey: "premium",
    status: SubscriptionStatus.trialing,
    stripeSubscriptionId: `sub_${tag}`,
    trialStartedAt: trialStart,
    trialEndsAt: trialEnd,
    isTrial: true,
  });

  const sub = await prisma.subscription.findUnique({ where: { businessId: business.id } });
  if (!sub) {
    fail("expired trial setup: subscription missing");
    return false;
  }

  await downgradeToInternalBasic({
    subscriptionRowId: sub.id,
    businessId: business.id,
    reason: "trial_expired_unpaid",
  });

  const updated = await prisma.subscription.findUnique({
    where: { businessId: business.id },
    select: {
      planKey: true,
      status: true,
      stripeSubscriptionId: true,
      isTrial: true,
      trialStartedAt: true,
      trialEndsAt: true,
      trialExpiredAt: true,
    },
  });

  if (!updated || !isInternalBasicSubscription(updated)) {
    fail("expired trial should downgrade to internal Basic active");
    return false;
  }

  if (!updated.trialStartedAt || !updated.trialEndsAt) {
    fail("expired trial should preserve trialStartedAt/trialEndsAt history");
    return false;
  }

  if (!updated.trialExpiredAt) {
    fail("expired trial should set trialExpiredAt");
    return false;
  }

  const entitlements = await resolveSubscriptionEntitlements(business.id);
  if (!entitlements.hasActiveEntitlements || entitlements.plan !== "basic") {
    fail("expired trial user should remain entitled on Basic");
    return false;
  }

  const billing = await getBillingStatusForBusiness(business.id);
  if (billing.status !== SubscriptionStatus.active || billing.canStartTrial) {
    fail("expired trial billing should be basic/active with canStartTrial=false");
    return false;
  }

  if (!billing.trialUsed || billing.trialEligible) {
    fail("expired trial billing must report trialUsed=true and trialEligible=false");
    return false;
  }

  pass("expired Pro trial returns Basic active with preserved history");
  return true;
}

async function testActiveProTrialDoesNotReportTrialUsed(): Promise<boolean> {
  if (!billingPrereqsOk()) {
    pass("active Pro trial trialUsed — SKIP (billing/stripe/trial env not fully enabled)");
    return true;
  }

  const tag = `c2-active-trial-${Date.now()}`;
  const trialStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const trialEnd = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000);
  const business = await createManagerBusiness(tag, {
    planKey: "premium",
    status: SubscriptionStatus.trialing,
    stripeSubscriptionId: `sub_${tag}`,
    trialStartedAt: trialStart,
    trialEndsAt: trialEnd,
    isTrial: true,
  });

  const eligibility = await resolveTrialEligibilityForBusiness(business.id);
  if (eligibility.eligible || eligibility.reason !== "trialing_pro") {
    fail(`active trial should be trialing_pro, got reason=${eligibility.reason}`);
    return false;
  }
  if (eligibility.trialUsed) {
    fail("active Pro trial must not set trialUsed=true (UI treats that as expired)");
    return false;
  }

  const billing = await getBillingStatusForBusiness(business.id);
  if (!billing.isTrial || billing.trialUsed) {
    fail("active trial billing must be isTrial with trialUsed=false");
    return false;
  }

  pass("active Pro trial does not report trialUsed");
  return true;
}

async function testTrialCannotBeRepeated(): Promise<boolean> {
  const tag = `c2-repeat-${Date.now()}`;
  const trialStart = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
  const business = await createManagerBusiness(tag, {
    planKey: "basic",
    status: SubscriptionStatus.active,
    trialStartedAt: trialStart,
    trialEndsAt: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000),
  });
  await prisma.subscription.update({
    where: { businessId: business.id },
    data: { trialExpiredAt: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000) },
  });

  const eligibility = await resolveTrialEligibilityForBusiness(business.id);
  if (eligibility.eligible || !eligibility.trialUsed || eligibility.reason !== "trial_used") {
    fail(`consumed trial should block repeat, got reason=${eligibility.reason}`);
    return false;
  }

  if (eligibility.lastTrialPlanKey !== "premium") {
    fail(`lastTrialPlanKey should be premium after Pro trial, got ${eligibility.lastTrialPlanKey}`);
    return false;
  }

  try {
    await assertTrialCheckoutAllowed(business.id, "premium");
    fail("assertTrialCheckoutAllowed should reject repeated trial");
    return false;
  } catch {
    pass("trial cannot be repeated");
    return true;
  }
}

async function testBasicTrialCheckoutRejected(): Promise<boolean> {
  const tag = `c2-basic-checkout-${Date.now()}`;
  const business = await createManagerBusiness(tag);

  try {
    await assertTrialCheckoutAllowed(business.id, "basic");
    fail("basic planKey trial checkout should be rejected");
    return false;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("Pro")) {
      fail(`expected Pro-only trial message, got: ${msg}`);
      return false;
    }
    pass("basic planKey trial checkout rejected");
    return true;
  }
}

async function main() {
  let ok = true;
  ok = (await testProOnlyTrialPlanKey()) && ok;
  ok = (await testBasicTrialCheckoutRejected()) && ok;
  ok = (await testBasicUserCanStartProTrial()) && ok;
  ok = (await testActiveProCannotStartTrial()) && ok;
  ok = (await testPremiumCannotStartTrial()) && ok;
  ok = (await testExpiredProTrialReturnsBasic()) && ok;
  ok = (await testActiveProTrialDoesNotReportTrialUsed()) && ok;
  ok = (await testTrialCannotBeRepeated()) && ok;

  console.log("Commit 2 — Pro trial lifecycle runtime checks\n");
  for (const line of results) {
    console.log(line);
  }

  if (!ok) {
    process.exitCode = 1;
    console.log("\nRESULT: FAIL");
    return;
  }
  console.log("\nRESULT: PASS");
}

void main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
