/**
 * Paused subscription entitlement regression (mocked / pure — no DB, no Stripe network).
 * Run: npm run test:subscription-paused-entitlement
 */
import { SubscriptionStatus } from "@prisma/client";
import {
  isStripeSubscriptionStatusPaused,
  mapStripeSubscriptionStatus,
} from "../src/lib/subscription/mapStripeSubscriptionStatus.js";
import { isSubscriptionMirrorEntitled } from "../src/lib/subscription/subscriptionMirrorEntitlement.js";
import {
  MIRROR_SUBSCRIPTION_CHECKOUT_BLOCK_STATUSES,
  STRIPE_BILLING_BLOCK_STATUSES,
} from "../src/services/billingLifecycleIntegrity.service.js";
import {
  BillingCheckoutVerificationError,
  evaluateStripeListOutcomeForCheckout,
  mirrorBlocksNewCheckout,
} from "../src/services/billingCheckoutGuard.service.js";
import {
  resolveBusinessTierDualWrite,
  type StripeMirrorSnapshot,
} from "../src/services/subscription.service.js";
import { SubscriptionPlanKey, BillingCycle } from "@prisma/client";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const baseMirror = (): Pick<
  StripeMirrorSnapshot,
  | "cancelAtPeriodEnd"
  | "cancellationEffective"
  | "currentPeriodEnd"
  | "canceledAt"
  | "planKey"
  | "billingCycle"
  | "stripeSubscriptionId"
  | "stripeCustomerId"
  | "stripePriceId"
  | "currentPeriodStart"
  | "renewalDate"
  | "trialStartedAt"
  | "trialEndsAt"
  | "trialSource"
  | "isTrial"
  | "trialExpiredAt"
> => ({
  stripeSubscriptionId: "sub_test",
  stripeCustomerId: "cus_test",
  stripePriceId: "price_test",
  planKey: SubscriptionPlanKey.premium,
  billingCycle: BillingCycle.monthly,
  currentPeriodStart: new Date(),
  currentPeriodEnd: new Date(Date.now() + 86400000),
  renewalDate: new Date(Date.now() + 86400000),
  cancelAtPeriodEnd: false,
  canceledAt: null,
  cancellationEffective: null,
  trialStartedAt: null,
  trialEndsAt: null,
  trialSource: null,
  isTrial: false,
  trialExpiredAt: null,
});

// --- mapping ---
const pausedMap = mapStripeSubscriptionStatus("paused");
assert(pausedMap.status === SubscriptionStatus.paused, "paused maps to mirror paused");
assert(pausedMap.rawStripeStatus === "paused", "raw stripe status preserved");
assert(isStripeSubscriptionStatusPaused("PAUSED"), "paused detector case-insensitive");
assert(!isStripeSubscriptionStatusPaused("active"), "active is not paused");

const activeMap = mapStripeSubscriptionStatus("active");
assert(activeMap.status === SubscriptionStatus.active, "active unchanged");

// --- entitlement ---
const periodEnd = new Date(Date.now() + 7 * 86400000);
assert(
  !isSubscriptionMirrorEntitled({
    status: SubscriptionStatus.paused,
    cancelAtPeriodEnd: false,
    cancellationEffective: null,
    currentPeriodEnd: periodEnd,
    canceledAt: null,
  }),
  "paused mirror not entitled",
);
assert(
  isSubscriptionMirrorEntitled({
    status: SubscriptionStatus.active,
    cancelAtPeriodEnd: false,
    cancellationEffective: null,
    currentPeriodEnd: periodEnd,
    canceledAt: null,
  }),
  "active still entitled",
);
assert(
  isSubscriptionMirrorEntitled({
    status: SubscriptionStatus.trialing,
    cancelAtPeriodEnd: false,
    cancellationEffective: null,
    currentPeriodEnd: periodEnd,
    canceledAt: null,
  }),
  "trialing entitled",
);
assert(
  isSubscriptionMirrorEntitled({
    status: SubscriptionStatus.past_due,
    cancelAtPeriodEnd: false,
    cancellationEffective: null,
    currentPeriodEnd: periodEnd,
    canceledAt: null,
  }),
  "past_due entitled",
);
assert(
  !isSubscriptionMirrorEntitled({
    status: SubscriptionStatus.canceled,
    cancelAtPeriodEnd: false,
    cancellationEffective: null,
    currentPeriodEnd: null,
    canceledAt: new Date(Date.now() - 1000),
  }),
  "canceled after grace not entitled",
);
assert(
  isSubscriptionMirrorEntitled({
    status: SubscriptionStatus.canceled,
    cancelAtPeriodEnd: true,
    cancellationEffective: periodEnd,
    currentPeriodEnd: periodEnd,
    canceledAt: null,
  }),
  "cancel at period end grace entitled",
);

// active → paused transition (snapshot build path uses mapper)
const pausedSnapshot: StripeMirrorSnapshot = {
  ...baseMirror(),
  status: mapStripeSubscriptionStatus("paused").status,
};
assert(
  resolveBusinessTierDualWrite(pausedSnapshot) === null,
  "paused snapshot clears legacy tier dual-write",
);
const activeSnapshot: StripeMirrorSnapshot = {
  ...baseMirror(),
  status: SubscriptionStatus.active,
};
assert(
  resolveBusinessTierDualWrite(activeSnapshot) != null,
  "active snapshot keeps tier dual-write",
);

// --- checkout guard ---
assert(
  mirrorBlocksNewCheckout({
    stripeSubscriptionId: "sub_1",
    status: SubscriptionStatus.paused,
    planKey: SubscriptionPlanKey.premium,
    isTrial: false,
    cancelAtPeriodEnd: false,
    cancellationEffective: null,
    currentPeriodEnd: periodEnd,
    canceledAt: null,
  }),
  "paused mirror blocks new checkout",
);
assert(
  !mirrorBlocksNewCheckout({
    stripeSubscriptionId: null,
    status: SubscriptionStatus.paused,
    planKey: SubscriptionPlanKey.basic,
    isTrial: false,
    cancelAtPeriodEnd: false,
    cancellationEffective: null,
    currentPeriodEnd: null,
    canceledAt: null,
  }),
  "paused without stripe id does not block",
);
assert(MIRROR_SUBSCRIPTION_CHECKOUT_BLOCK_STATUSES.has(SubscriptionStatus.paused), "paused in checkout block set");

// Stripe list guard uses Stripe status strings (includes paused)
assert(STRIPE_BILLING_BLOCK_STATUSES.has("paused"), "stripe paused blocks duplicate checkout via list");

let threw = false;
try {
  evaluateStripeListOutcomeForCheckout({ kind: "verification_failed" });
} catch (e) {
  threw = e instanceof BillingCheckoutVerificationError;
}
assert(threw, "stripe outage fails closed on checkout — not treated as paused");

threw = false;
try {
  evaluateStripeListOutcomeForCheckout({ kind: "skipped_stripe_unavailable" });
} catch (e) {
  threw = e instanceof BillingCheckoutVerificationError;
}
assert(threw, "stripe unavailable fails closed on checkout");

console.log("subscription-paused-entitlement-runtime: ok");
