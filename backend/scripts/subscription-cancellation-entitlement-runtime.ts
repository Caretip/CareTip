/**
 * Cancellation must not grant, remove or preserve paid access incorrectly.
 * Covers every Stripe mirror status against the paid period, for entitlement and tier dual-write.
 */
import assert from "node:assert/strict";
import { BusinessSubscriptionTier, SubscriptionStatus } from "@prisma/client";
import { isSubscriptionMirrorEntitled } from "../src/lib/subscription/subscriptionMirrorEntitlement.js";
import {
  resolveBusinessTierDualWrite,
  type StripeMirrorSnapshot,
} from "../src/services/subscription.service.js";

const days = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

function snapshot(overrides: Partial<StripeMirrorSnapshot>): StripeMirrorSnapshot {
  return {
    stripeSubscriptionId: "sub_cancel_matrix",
    stripeCustomerId: "cus_cancel_matrix",
    stripePriceId: "price_premium",
    planKey: "premium",
    status: SubscriptionStatus.active,
    billingCycle: "monthly",
    currentPeriodStart: days(-10),
    currentPeriodEnd: days(20),
    renewalDate: days(20),
    cancelAtPeriodEnd: false,
    canceledAt: null,
    cancellationEffective: null,
    trialStartedAt: null,
    trialEndsAt: null,
    trialSource: null,
    isTrial: false,
    trialExpiredAt: null,
    ...overrides,
  } as StripeMirrorSnapshot;
}

type Case = [name: string, overrides: Partial<StripeMirrorSnapshot>, entitled: boolean];

const cases: Case[] = [
  ["active, no cancellation", {}, true],
  ["trialing", { status: SubscriptionStatus.trialing, isTrial: true }, true],
  ["past_due keeps grace access", { status: SubscriptionStatus.past_due }, true],
  ["cancelled at period end, still inside period", { cancelAtPeriodEnd: true, cancellationEffective: days(14), currentPeriodEnd: days(14) }, true],
  ["cancelled at period end, period passed, webhook never arrived", { cancelAtPeriodEnd: true, cancellationEffective: days(-1), currentPeriodEnd: days(-1) }, false],
  ["cancelled at period end with no explicit date, period passed", { cancelAtPeriodEnd: true, cancellationEffective: null, currentPeriodEnd: days(-1) }, false],
  ["status canceled, effective date still ahead", { status: SubscriptionStatus.canceled, cancellationEffective: days(5) }, true],
  ["status canceled, effective date passed", { status: SubscriptionStatus.canceled, cancellationEffective: days(-1), currentPeriodEnd: days(-1) }, false],
  ["immediate cancel inside a paid period", { status: SubscriptionStatus.canceled, canceledAt: days(-1), cancellationEffective: days(-1) }, false],
  ["paused", { status: SubscriptionStatus.paused }, false],
  ["unpaid", { status: SubscriptionStatus.unpaid }, false],
  ["incomplete", { status: SubscriptionStatus.incomplete }, false],
];

for (const [name, overrides, entitled] of cases) {
  const snap = snapshot(overrides);
  assert.equal(isSubscriptionMirrorEntitled(snap), entitled, `${name}: entitlement`);
  const tier = resolveBusinessTierDualWrite(snap);
  if (entitled) {
    assert.equal(tier, BusinessSubscriptionTier.premium, `${name}: keeps the paid tier`);
  } else {
    assert.equal(tier, null, `${name}: clears the paid tier`);
  }
}

console.log(`subscription-cancellation-entitlement: ${cases.length} cases ok`);
process.exit(0);
