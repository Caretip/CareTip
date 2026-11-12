/**
 * Commit 3 — Stripe cleanup runtime checks (no live Stripe API for blocked paths).
 * Run: npm run test:subscription-stripe-cleanup
 */
import "dotenv/config";
import "../src/loadEnv.js";
import bcrypt from "bcrypt";
import { BillingCycle, SubscriptionPlanKey, SubscriptionStatus } from "@prisma/client";
import {
  assertSelfServeCheckoutPlanKey,
  BASIC_CHECKOUT_NOT_REQUIRED_MESSAGE,
  ENTERPRISE_CHECKOUT_CONTACT_SALES_MESSAGE,
  isSelfServeCheckoutPlanKey,
} from "../src/lib/subscription/billingCheckoutPolicy.js";
import { prisma } from "../src/prisma.js";
import { createManagerCheckoutSession } from "../src/services/managerBilling.service.js";
import { reconcileOneSubscription } from "../src/services/subscriptionReconciliation.service.js";
import { activateSubscriptionMirrorFromStripeSubscription } from "../src/services/subscriptionActivation.service.js";
import { __setSubscriptionRetrieveFnForTests } from "../src/services/subscriptionStripeSync.js";
import { STRIPE_BILLING_AUDIT_TYPES } from "../src/lib/subscription/subscriptionAuditTypes.js";
import {
  isInternalBasicSubscription,
  provisionInternalBasicSubscription,
} from "../src/services/subscription.service.js";
import { resolveSubscriptionEntitlements } from "../src/services/subscriptionEntitlement.service.js";
import { assertTrialCheckoutAllowed } from "../src/services/trialEligibility.service.js";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

function futureUnix(days: number): number {
  return Math.floor((Date.now() + days * 86_400_000) / 1000);
}

function pastUnix(days: number): number {
  return Math.floor((Date.now() - days * 86_400_000) / 1000);
}

function mockStripeSubscription(params: {
  businessId: string;
  subId: string;
  planKey: SubscriptionPlanKey;
  status: string;
  trial?: boolean;
  currentPeriodEnd?: number;
  cancelAtPeriodEnd?: boolean;
}) {
  const priceId =
    process.env.STRIPE_PRICE_PREMIUM_MONTHLY?.trim() ?? "price_1TqZcI66w930Tx0AUQL29FY4";
  return {
    id: params.subId,
    status: params.status,
    customer: "cus_test",
    metadata: { caretipBusinessId: params.businessId, caretipPlanKey: params.planKey },
    trial_start: params.trial ? Math.floor(Date.now() / 1000) : null,
    trial_end: params.trial ? futureUnix(28) : null,
    current_period_start: Math.floor(Date.now() / 1000),
    current_period_end: params.currentPeriodEnd ?? futureUnix(30),
    cancel_at_period_end: params.cancelAtPeriodEnd ?? false,
    canceled_at: params.status === "canceled" ? pastUnix(1) : null,
    items: {
      data: [
        {
          price: {
            id: priceId,
            metadata: { caretipPlanKey: params.planKey },
            recurring: { interval: "month" },
          },
        },
      ],
    },
  };
}

async function testBasicCheckoutRejected(): Promise<boolean> {
  try {
    assertSelfServeCheckoutPlanKey("basic");
    fail("basic checkout should throw");
    return false;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg !== BASIC_CHECKOUT_NOT_REQUIRED_MESSAGE) {
      fail(`basic checkout message mismatch: ${msg}`);
      return false;
    }
    pass("Basic checkout rejected with correct message");
    return true;
  }
}

async function testPremiumCheckoutBlocked(): Promise<boolean> {
  try {
    assertSelfServeCheckoutPlanKey("enterprise");
    fail("enterprise checkout should throw");
    return false;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg !== ENTERPRISE_CHECKOUT_CONTACT_SALES_MESSAGE) {
      fail(`enterprise checkout message mismatch: ${msg}`);
      return false;
    }
    pass("Premium (enterprise) self-serve checkout blocked");
    return true;
  }
}

async function testProCheckoutPlanAllowed(): Promise<boolean> {
  if (!isSelfServeCheckoutPlanKey("premium")) {
    fail("premium should be self-serve checkout plan");
    return false;
  }
  try {
    assertSelfServeCheckoutPlanKey("premium");
    pass("Pro (premium) planKey allowed for self-serve checkout policy");
    return true;
  } catch {
    fail("premium checkout policy should not throw");
    return false;
  }
}

async function testBasicUserNoStripeRequired(): Promise<boolean> {
  const tag = `c3-basic-${Date.now()}`;
  const passwordHash = await bcrypt.hash("TestPass1!", 10);
  const user = await prisma.user.create({
    data: {
      email: `${tag}@caretip-test.local`,
      passwordHash,
      role: "MANAGER",
      emailVerified: true,
      business: {
        create: { name: `${tag} venue`, slug: `${tag}-venue` },
      },
    },
    include: { business: true },
  });
  if (!user.business) {
    fail("basic user setup failed");
    return false;
  }

  await provisionInternalBasicSubscription(user.business.id, { source: "auto_heal" });

  const sub = await prisma.subscription.findUnique({
    where: { businessId: user.business.id },
    select: {
      planKey: true,
      status: true,
      stripeSubscriptionId: true,
      isTrial: true,
    },
  });

  if (!sub || !isInternalBasicSubscription(sub)) {
    fail("basic user should have internal Basic mirror");
    return false;
  }

  try {
    await createManagerCheckoutSession({
      businessId: user.business.id,
      managerEmail: user.email ?? `${tag}@caretip-test.local`,
      businessName: user.business.name,
      planKey: "basic",
    });
    fail("createManagerCheckoutSession should reject basic");
    return false;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("Basic is included automatically")) {
      fail(`unexpected basic checkout error: ${msg}`);
      return false;
    }
  }

  pass("Basic user does not require Stripe checkout");
  return true;
}

async function testProTrialEligibilityOnBasic(): Promise<boolean> {
  const tag = `c3-trial-${Date.now()}`;
  const passwordHash = await bcrypt.hash("TestPass1!", 10);
  const user = await prisma.user.create({
    data: {
      email: `${tag}@caretip-test.local`,
      passwordHash,
      role: "MANAGER",
      emailVerified: true,
      business: {
        create: { name: `${tag} venue`, slug: `${tag}-venue` },
      },
    },
    include: { business: true },
  });
  if (!user.business) {
    fail("trial setup failed");
    return false;
  }
  await provisionInternalBasicSubscription(user.business.id, { source: "auto_heal" });

  const billingOn =
    process.env.SUBSCRIPTION_BILLING_ENABLED?.trim().toLowerCase() === "true" ||
    process.env.SUBSCRIPTION_BILLING_ENABLED === "1";
  const stripeKey = Boolean(process.env.STRIPE_SECRET_KEY?.trim());
  if (!billingOn || !stripeKey) {
    pass("Pro trial eligibility on Basic — SKIP (billing/stripe env)");
    return true;
  }

  try {
    await assertTrialCheckoutAllowed(user.business.id, "premium");
    pass("Basic user eligible for Pro trial checkout (premium planKey)");
    return true;
  } catch (e) {
    fail(`Pro trial eligibility failed: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

async function testProCancelReturnsBasic(): Promise<boolean> {
  const tag = `c3-cancel-${Date.now()}`;
  const passwordHash = await bcrypt.hash("TestPass1!", 10);
  const subId = `sub_${tag}`;
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
              billingCycle: BillingCycle.monthly,
              stripeSubscriptionId: subId,
              stripePriceId: "price_test",
            },
          },
        },
      },
    },
    include: { business: true },
  });

  if (!user.business) {
    fail("pro cancel setup failed");
    return false;
  }

  const canceled = mockStripeSubscription({
    businessId: user.business.id,
    subId,
    planKey: "premium",
    status: "canceled",
    currentPeriodEnd: pastUnix(1),
  });

  // Activation re-reads the subscription from Stripe under the sync lease; the mock is Stripe's state.
  __setSubscriptionRetrieveFnForTests(async () => canceled as never);
  await activateSubscriptionMirrorFromStripeSubscription({
    businessId: user.business.id,
    sub: canceled as never,
    auditType: STRIPE_BILLING_AUDIT_TYPES.subscriptionDeleted,
    stripeEventId: `evt_${tag}`,
    source: "webhook_subscription_deleted",
  });

  __setSubscriptionRetrieveFnForTests(null);
  const ent = await resolveSubscriptionEntitlements(user.business.id);
  const sub = await prisma.subscription.findUnique({
    where: { businessId: user.business.id },
    select: { planKey: true, status: true, stripeSubscriptionId: true, isTrial: true },
  });

  if (!ent.hasActiveEntitlements || ent.plan !== "basic") {
    fail(`pro cancel should return Basic entitled, got plan=${ent.plan}`);
    return false;
  }
  if (!sub || !isInternalBasicSubscription(sub)) {
    fail("pro cancel should leave internal Basic mirror");
    return false;
  }

  pass("Pro cancel / subscription.deleted returns Basic active");
  return true;
}

async function testReconciliationSkipsInternalBasic(): Promise<boolean> {
  const tag = `c3-recon-${Date.now()}`;
  const passwordHash = await bcrypt.hash("TestPass1!", 10);
  const user = await prisma.user.create({
    data: {
      email: `${tag}@caretip-test.local`,
      passwordHash,
      role: "MANAGER",
      emailVerified: true,
      business: {
        create: { name: `${tag} venue`, slug: `${tag}-venue` },
      },
    },
    include: { business: true },
  });
  if (!user.business) {
    fail("reconciliation setup failed");
    return false;
  }

  const provisioned = await provisionInternalBasicSubscription(user.business.id, {
    source: "auto_heal",
  });
  const repaired = await reconcileOneSubscription(provisioned.subscriptionId);

  if (repaired) {
    fail("reconciliation should skip internal Basic (no stripeSubscriptionId)");
    return false;
  }

  pass("internal Basic ignored by Stripe reconciliation");
  return true;
}

async function main() {
  let ok = true;
  ok = (await testBasicCheckoutRejected()) && ok;
  ok = (await testPremiumCheckoutBlocked()) && ok;
  ok = (await testProCheckoutPlanAllowed()) && ok;
  ok = (await testBasicUserNoStripeRequired()) && ok;
  ok = (await testProTrialEligibilityOnBasic()) && ok;
  ok = (await testProCancelReturnsBasic()) && ok;
  ok = (await testReconciliationSkipsInternalBasic()) && ok;

  console.log("Commit 3 — Stripe cleanup runtime checks\n");
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
