/**
 * Commit 6 — Full Basic → Pro → Premium lifecycle verification.
 * Run: npm run test:subscription-lifecycle-e2e
 */
import "dotenv/config";
import "../src/loadEnv.js";
import bcrypt from "bcrypt";
import { SubscriptionStatus } from "@prisma/client";
import { prisma } from "../src/prisma.js";
import {
  capabilitiesForTier,
  hasSubscriptionCapability,
  type SubscriptionCapability,
} from "../src/config/subscriptionCapabilities.js";
import { createLocationForBusinessUser } from "../src/services/locations.service.js";
import { getBillingStatusForBusiness } from "../src/services/managerBilling.service.js";
import {
  hasFeature,
  resolveSubscriptionEntitlements,
} from "../src/services/subscriptionEntitlement.service.js";
import {
  downgradeToInternalBasic,
  isInternalBasicSubscription,
  provisionInternalBasicSubscription,
} from "../src/services/subscription.service.js";
import { resolveTrialEligibilityForBusiness } from "../src/services/trialEligibility.service.js";

const BASIC_ALLOW: SubscriptionCapability[] = [
  "tipManagement",
  "employeeQr",
  "locationQr",
  "tableQr",
  "basicAnalytics",
  "qrTemplates",
  // Pay-per-print physical QR orders are available on Basic (175e5577).
  "physicalQrPrinting",
  "teamManagement",
];

const PRO_ONLY: SubscriptionCapability[] = [
  // The monthly included print order is Pro-only (175e5577).
  "physicalQrPrintingIncluded",
  "brandingCustomization",
  "advancedAnalytics",
  "csvExport",
  "multiLocation",
  "employeeGoals",
  "customerFeedback",
  // Pro-only custom job titles (see git log -S customJobTitles on subscriptionCapabilities.ts).
  "customJobTitles",
];

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

async function createSignupBusiness(tag: string) {
  const passwordHash = await bcrypt.hash("TestPass1!", 10);
  const user = await prisma.user.create({
    data: {
      email: `${tag}@caretip-test.local`,
      passwordHash,
      role: "MANAGER",
      emailVerified: false,
      business: {
        create: {
          name: `${tag} venue`,
          slug: `${tag}-venue`,
        },
      },
    },
    include: { business: true },
  });
  if (!user.business) throw new Error("business missing");
  return user.business;
}

async function createPremiumBusiness(tag: string) {
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
          subscriptionTier: "premium",
          subscription: {
            create: {
              planKey: "premium",
              status: SubscriptionStatus.active,
              billingCycle: "monthly",
              stripeSubscriptionId: `sub_${tag}`,
              stripePriceId: "price_test",
            },
          },
        },
      },
    },
    include: { business: true },
  });
  if (!user.business) throw new Error("business missing");
  return user.business;
}

async function createEnterpriseBusiness(tag: string) {
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
          subscriptionTier: "enterprise",
          subscription: {
            create: {
              planKey: "enterprise",
              status: SubscriptionStatus.active,
              billingCycle: "monthly",
              stripeSubscriptionId: `sub_${tag}`,
              stripePriceId: "price_test",
            },
          },
        },
      },
    },
    include: { business: true },
  });
  if (!user.business) throw new Error("business missing");
  return user.business;
}

async function testSignupBasicActive(): Promise<boolean> {
  const tag = `c6-signup-${Date.now()}`;
  const business = await createSignupBusiness(tag);
  await provisionInternalBasicSubscription(business.id, { source: "email_signup" });
  const businessId = business.id;
  if (!businessId) {
    fail("signup: missing businessId");
    return false;
  }

  const sub = await prisma.subscription.findUnique({ where: { businessId } });
  const ent = await resolveSubscriptionEntitlements(businessId);

  let ok = true;
  if (!sub || !isInternalBasicSubscription(sub)) {
    fail("signup: internal Basic mirror missing");
    ok = false;
  }
  if (sub?.planKey !== "basic" || sub.status !== SubscriptionStatus.active) {
    fail(`signup: expected basic/active, got ${sub?.planKey}/${sub?.status}`);
    ok = false;
  }
  if (!ent.hasActiveEntitlements || ent.plan !== "basic") {
    fail("signup: entitlements should be basic active");
    ok = false;
  }
  if (ok) pass("new signup → basic/active entitled");
  return ok;
}

async function testBasicCapabilities(): Promise<boolean> {
  const tag = `c6-basic-${Date.now()}`;
  const business = await createPremiumBusiness(tag);
  await downgradeToInternalBasic({
    subscriptionRowId: (await prisma.subscription.findUniqueOrThrow({ where: { businessId: business.id } })).id,
    businessId: business.id,
    reason: "test_reset_basic",
  });

  let ok = true;
  for (const cap of BASIC_ALLOW) {
    if (!(await hasFeature(business.id, cap))) {
      fail(`basic allow: missing ${cap}`);
      ok = false;
    }
  }
  for (const cap of PRO_ONLY) {
    if (await hasFeature(business.id, cap)) {
      fail(`basic block: should not have ${cap}`);
      ok = false;
    }
  }
  if (ok) pass("basic user: core allowed, pro features blocked");
  return ok;
}

async function testProTrialUnlocksFeatures(): Promise<boolean> {
  const tag = `c6-trial-${Date.now()}`;
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
          subscriptionTier: "premium",
          subscription: {
            create: {
              planKey: "premium",
              status: SubscriptionStatus.trialing,
              billingCycle: "monthly",
              stripeSubscriptionId: `sub_${tag}`,
              stripePriceId: "price_test",
              isTrial: true,
              trialStartedAt: new Date(),
              trialEndsAt: new Date(Date.now() + 28 * 86400000),
            },
          },
        },
      },
    },
    include: { business: true },
  });
  const businessId = user.business!.id;
  const ent = await resolveSubscriptionEntitlements(businessId);
  const billing = await getBillingStatusForBusiness(businessId);

  let ok = true;
  if (ent.plan !== "premium" || ent.status !== "trialing") {
    fail(`pro trial: expected premium/trialing, got ${ent.plan}/${ent.status}`);
    ok = false;
  }
  if (!(await hasFeature(businessId, "advancedAnalytics"))) {
    fail("pro trial: advancedAnalytics should be unlocked");
    ok = false;
  }
  if (billing.trialDaysRemaining == null || billing.trialDaysRemaining <= 0) {
    fail("pro trial: trial countdown should be visible in billing DTO");
    ok = false;
  }
  if (ok) pass("pro trial: premium/trialing with pro features + countdown");
  return ok;
}

async function testExpiredTrialReturnsBasic(): Promise<boolean> {
  const tag = `c6-expired-${Date.now()}`;
  const business = await createPremiumBusiness(tag);
  const sub = await prisma.subscription.findUniqueOrThrow({ where: { businessId: business.id } });
  await prisma.subscription.update({
    where: { id: sub.id },
    data: {
      status: SubscriptionStatus.trialing,
      isTrial: true,
      trialStartedAt: new Date(Date.now() - 30 * 86400000),
      trialEndsAt: new Date(Date.now() - 2 * 86400000),
    },
  });

  await downgradeToInternalBasic({
    subscriptionRowId: sub.id,
    businessId: business.id,
    reason: "trial_expired_unpaid",
  });

  const ent = await resolveSubscriptionEntitlements(business.id);
  let ok = true;
  if (!ent.hasActiveEntitlements || ent.plan !== "basic") {
    fail("expired trial: should return basic active");
    ok = false;
  }
  if (await hasFeature(business.id, "advancedAnalytics")) {
    fail("expired trial: pro features should lock again");
    ok = false;
  }
  const eligibility = await resolveTrialEligibilityForBusiness(business.id);
  if (eligibility.eligible) {
    fail("expired trial: trial should not be eligible again");
    ok = false;
  }
  if (ok) pass("expired trial → basic/active, pro locked, upgrade path available");
  return ok;
}

async function testProSubscriptionCapabilities(): Promise<boolean> {
  const tag = `c6-pro-${Date.now()}`;
  const business = await createPremiumBusiness(tag);
  const ent = await resolveSubscriptionEntitlements(business.id);

  let ok = true;
  if (ent.plan !== "premium" || ent.status !== "active") {
    fail(`pro active: expected premium/active, got ${ent.plan}/${ent.status}`);
    ok = false;
  }
  for (const cap of [...BASIC_ALLOW, ...PRO_ONLY]) {
    if (!(await hasFeature(business.id, cap))) {
      fail(`pro active: missing ${cap}`);
      ok = false;
    }
  }
  if (ok) pass("pro subscription: all pro capabilities available");
  return ok;
}

async function testCancelProReturnsBasic(): Promise<boolean> {
  const tag = `c6-cancel-${Date.now()}`;
  const business = await createPremiumBusiness(tag);
  const sub = await prisma.subscription.findUniqueOrThrow({ where: { businessId: business.id } });

  await downgradeToInternalBasic({
    subscriptionRowId: sub.id,
    businessId: business.id,
    reason: "stripe_subscription_ended",
  });

  const businessStill = await prisma.business.findUnique({ where: { id: business.id } });
  const ent = await resolveSubscriptionEntitlements(business.id);
  let ok = true;
  if (!businessStill) {
    fail("cancel pro: business should not be deleted");
    ok = false;
  }
  if (!ent.hasActiveEntitlements || ent.plan !== "basic") {
    fail("cancel pro: should downgrade to basic active");
    ok = false;
  }
  if (ok) pass("cancel pro at period end → basic active, no data loss");
  return ok;
}

async function testPremiumEnterprise(): Promise<boolean> {
  const tag = `c6-premium-${Date.now()}`;
  const business = await createEnterpriseBusiness(tag);
  const ent = await resolveSubscriptionEntitlements(business.id);
  let ok = true;
  if (ent.plan !== "enterprise" || !ent.hasActiveEntitlements) {
    fail("premium: enterprise plan should be fully entitled");
    ok = false;
  }
  if (!(await hasFeature(business.id, "advancedAnalytics"))) {
    fail("premium: should include pro capabilities");
    ok = false;
  }
  if (ok) pass("premium (enterprise): entitled with pro capabilities");
  return ok;
}

async function testBasicLocationCap(): Promise<boolean> {
  const tag = `c6-loc-${Date.now()}`;
  const passwordHash = await bcrypt.hash("TestPass1!", 10);
  const user = await prisma.user.create({
    data: {
      email: `${tag}@caretip-test.local`,
      passwordHash,
      role: "MANAGER",
      emailVerified: true,
      business: { create: { name: `${tag} venue`, slug: `${tag}-venue` } },
    },
    include: { business: true },
  });
  if (!user.business) {
    fail("basic location cap: business missing");
    return false;
  }
  const businessId = user.business.id;
  await provisionInternalBasicSubscription(businessId, { source: "auto_heal" });

  await createLocationForBusinessUser(user.id, "Primary");
  let blocked = false;
  try {
    await createLocationForBusinessUser(user.id, "Second");
  } catch {
    blocked = true;
  }
  if (!blocked) {
    fail("basic: second location should be blocked");
    return false;
  }
  pass("basic: multi-location blocked at API layer");
  return true;
}

function testCapabilityMatrixSync(): boolean {
  let ok = true;
  for (const cap of BASIC_ALLOW) {
    if (!hasSubscriptionCapability("basic", cap)) {
      fail(`matrix: basic missing ${cap}`);
      ok = false;
    }
  }
  for (const cap of PRO_ONLY) {
    if (hasSubscriptionCapability("basic", cap)) {
      fail(`matrix: basic should not have ${cap}`);
      ok = false;
    }
    if (!hasSubscriptionCapability("premium", cap)) {
      fail(`matrix: premium missing ${cap}`);
      ok = false;
    }
  }
  const basicCount = capabilitiesForTier("basic").length;
  if (basicCount !== BASIC_ALLOW.length) {
    fail(`matrix: basic capability count ${basicCount} !== ${BASIC_ALLOW.length}`);
    ok = false;
  }
  if (ok) pass("capability matrix: basic limited, pro advanced");
  return ok;
}

async function main() {
  let ok = true;
  ok = testCapabilityMatrixSync() && ok;
  ok = (await testSignupBasicActive()) && ok;
  ok = (await testBasicCapabilities()) && ok;
  ok = (await testBasicLocationCap()) && ok;
  ok = (await testProTrialUnlocksFeatures()) && ok;
  ok = (await testExpiredTrialReturnsBasic()) && ok;
  ok = (await testProSubscriptionCapabilities()) && ok;
  ok = (await testCancelProReturnsBasic()) && ok;
  ok = (await testPremiumEnterprise()) && ok;

  console.log("Commit 6 — subscription lifecycle E2E runtime checks\n");
  for (const line of results) console.log(line);

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
