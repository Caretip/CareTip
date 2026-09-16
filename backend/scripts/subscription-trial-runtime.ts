/**
 * Trial subscription regression checks (no live Stripe API required).
 * Run: npm run test:subscription-trial
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { BillingCycle, SubscriptionPlanKey, SubscriptionStatus } from "@prisma/client";
import {
  buildMirrorSnapshotFromStripeSubscription,
  resolveBusinessTierDualWrite,
  type StripeMirrorSnapshot,
} from "../src/services/subscription.service.js";
import { mapStripePriceToPlanKey } from "../src/lib/subscription/mapStripePriceToPlanKey.js";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

function futureDate(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function testTrialingGrantsPremiumTier(): boolean {
  const snapshot: StripeMirrorSnapshot = {
    stripeSubscriptionId: "sub_trial",
    stripeCustomerId: "cus_trial",
    stripePriceId: "price_premium",
    planKey: SubscriptionPlanKey.premium,
    status: SubscriptionStatus.trialing,
    billingCycle: BillingCycle.monthly,
    currentPeriodStart: new Date(),
    currentPeriodEnd: futureDate(28),
    renewalDate: futureDate(28),
    cancelAtPeriodEnd: false,
    canceledAt: null,
    cancellationEffective: null,
    trialStartedAt: new Date(),
    trialEndsAt: futureDate(28),
    trialSource: "stripe",
    isTrial: true,
    trialExpiredAt: null,
  };
  const tier = resolveBusinessTierDualWrite(snapshot);
  if (tier !== "premium") {
    fail(`trialing status should dual-write premium tier, got ${tier}`);
    return false;
  }
  pass("trialing status grants premium tier via dual-write");
  return true;
}

function testCancelDuringTrialPreservesAccess(): boolean {
  const snapshot: StripeMirrorSnapshot = {
    stripeSubscriptionId: "sub_trial_cancel",
    stripeCustomerId: "cus_trial_cancel",
    stripePriceId: "price_premium",
    planKey: SubscriptionPlanKey.premium,
    status: SubscriptionStatus.trialing,
    billingCycle: BillingCycle.monthly,
    currentPeriodStart: new Date(),
    currentPeriodEnd: futureDate(18),
    renewalDate: futureDate(18),
    cancelAtPeriodEnd: true,
    canceledAt: null,
    cancellationEffective: futureDate(18),
    trialStartedAt: new Date(),
    trialEndsAt: futureDate(18),
    trialSource: "stripe",
    isTrial: true,
    trialExpiredAt: null,
  };
  const tier = resolveBusinessTierDualWrite(snapshot);
  // cancel_at_period_end with future effective date: still entitled until trial/period end.
  if (tier !== "premium") {
    fail(`cancel during trial (future effective): expected premium until end, got ${tier}`);
    return false;
  }
  pass("cancel during trial preserves premium until trial end");
  return true;
}

function testIsTrialFlagOnSnapshot(): boolean {
  const sub = {
    id: "sub_mirror",
    status: "trialing",
    customer: "cus_1",
    trial_start: Math.floor(Date.now() / 1000),
    trial_end: Math.floor(futureDate(28).getTime() / 1000),
    current_period_start: Math.floor(Date.now() / 1000),
    current_period_end: Math.floor(futureDate(28).getTime() / 1000),
    cancel_at_period_end: false,
    canceled_at: null,
    items: {
      data: [
        {
          price: {
            id: "price_premium_monthly",
            metadata: { caretipPlanKey: "premium" },
            recurring: { interval: "month" },
          },
        },
      ],
    },
  };
  const snapshot = buildMirrorSnapshotFromStripeSubscription(sub as never);
  if (!snapshot.isTrial || snapshot.status !== SubscriptionStatus.trialing) {
    fail("buildMirrorSnapshotFromStripeSubscription should set isTrial for trialing subs");
    return false;
  }
  pass("mirror snapshot sets isTrial when Stripe status is trialing");
  return true;
}

function testPlanKeyFromSubscriptionMetadataFallback(): boolean {
  const sub = {
    id: "sub_meta_fallback",
    status: "trialing",
    customer: "cus_1",
    metadata: { caretipPlanKey: "premium" },
    trial_start: Math.floor(Date.now() / 1000),
    trial_end: Math.floor(futureDate(28).getTime() / 1000),
    current_period_start: Math.floor(Date.now() / 1000),
    current_period_end: Math.floor(futureDate(28).getTime() / 1000),
    cancel_at_period_end: false,
    canceled_at: null,
    items: {
      data: [
        {
          price: {
            id: "price_1TmJtr66w930Tx0AP8elVcUU",
            metadata: {},
            recurring: { interval: "month" },
          },
        },
      ],
    },
  };
  const prev = process.env.STRIPE_PRICE_PREMIUM_MONTHLY;
  delete process.env.STRIPE_PRICE_PREMIUM_MONTHLY;
  try {
    const snapshot = buildMirrorSnapshotFromStripeSubscription(sub as never);
    if (snapshot.planKey !== SubscriptionPlanKey.premium) {
      fail(`subscription metadata fallback expected premium, got ${snapshot.planKey}`);
      return false;
    }
    pass("planKey resolves from subscription metadata when price env map misses");
    return true;
  } catch (e) {
    fail(`subscription metadata fallback threw: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  } finally {
    if (prev !== undefined) process.env.STRIPE_PRICE_PREMIUM_MONTHLY = prev;
    else delete process.env.STRIPE_PRICE_PREMIUM_MONTHLY;
  }
}

function testCatalogMapsNewPremiumMonthlyPrice(): boolean {
  const prev = process.env.STRIPE_PRICE_PREMIUM_MONTHLY;
  delete process.env.STRIPE_PRICE_PREMIUM_MONTHLY;
  try {
    const planKey = mapStripePriceToPlanKey("price_1TmJtr66w930Tx0AP8elVcUU");
    if (planKey !== SubscriptionPlanKey.premium) {
      fail(`catalog should map new premium monthly price, got ${planKey}`);
      return false;
    }
    pass("catalog maps price_1TmJtr66w930Tx0AP8elVcUU → premium without env");
    return true;
  } catch (e) {
    fail(`catalog map threw: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  } finally {
    if (prev !== undefined) process.env.STRIPE_PRICE_PREMIUM_MONTHLY = prev;
    else delete process.env.STRIPE_PRICE_PREMIUM_MONTHLY;
  }
}

function main(): void {
  const checks = [
    testTrialingGrantsPremiumTier(),
    testCancelDuringTrialPreservesAccess(),
    testIsTrialFlagOnSnapshot(),
    testPlanKeyFromSubscriptionMetadataFallback(),
    testCatalogMapsNewPremiumMonthlyPrice(),
  ];
  const failed = checks.filter((ok) => !ok).length;
  console.log(results.join("\n"));
  if (failed > 0) {
    process.exitCode = 1;
    console.error(`\n${failed} trial regression check(s) failed.`);
  } else {
    console.log(`\nAll ${checks.length} trial regression checks passed.`);
  }
}

main();
