/**
 * Subscription reliability sprint 1 / 1.1 — unit checks (mocked Stripe list; no live Stripe).
 */
import { SubscriptionEventProcessingResult, SubscriptionPlanKey, SubscriptionStatus } from "@prisma/client";
import { classifyBillingWebhookEventRow } from "../src/services/billingWebhookIdempotency.service.js";
import {
  assertAdminSubscriptionTierChangeAllowed,
  AdminSubscriptionStripeConflictError,
  evaluateAdminSubscriptionTierChange,
} from "../src/lib/subscription/adminSubscriptionPolicy.js";
import { collectBillingConfigurationIssues } from "../src/config/billingConfigurationDiagnostics.js";
import {
  evaluateStripeListOutcomeForCheckout,
  BillingCheckoutBlockedError,
  BillingCheckoutVerificationError,
} from "../src/services/billingCheckoutGuard.service.js";
import { isPrismaUniqueViolationOnStripeEventId } from "../src/lib/prismaUniqueViolation.js";
import {
  __resetListStripeSubscriptionsForCustomerForTests,
  __setListStripeSubscriptionsForCustomerForTests,
  resolveOwnedEntitledStripeSubscriptionsForBusiness,
} from "../src/services/billingLifecycleIntegrity.service.js";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

assert(
  classifyBillingWebhookEventRow(null).action === "process",
  "no row → process",
);

assert(
  classifyBillingWebhookEventRow({
    processingResult: SubscriptionEventProcessingResult.processed,
    payload: {},
  }).action === "duplicate",
  "processed → duplicate",
);

assert(
  classifyBillingWebhookEventRow({
    processingResult: SubscriptionEventProcessingResult.failed,
    payload: { error: "db down" },
  }).action === "clear_and_process",
  "failed → clear_and_process (retryable)",
);

assert(
  classifyBillingWebhookEventRow({
    processingResult: SubscriptionEventProcessingResult.ignored,
    payload: { reason: "subscription_row_not_found" },
  }).action === "clear_and_process",
  "retryable ignored → clear_and_process",
);

assert(
  classifyBillingWebhookEventRow({
    processingResult: SubscriptionEventProcessingResult.ignored,
    payload: { reason: "activation_ignored" },
  }).action === "duplicate",
  "terminal ignored → duplicate",
);

assert(
  classifyBillingWebhookEventRow({
    processingResult: SubscriptionEventProcessingResult.processing,
    payload: { phase: "claim_acquired" },
  }).action === "duplicate",
  "in-flight processing → duplicate (classifier only; claim service serializes)",
);

assert(
  isPrismaUniqueViolationOnStripeEventId({
    code: "P2002",
    meta: { target: ["stripe_event_id"] },
  }),
  "P2002 on stripe_event_id detected",
);

assert(
  !isPrismaUniqueViolationOnStripeEventId({
    code: "P2002",
    meta: { target: ["business_id"] },
  }),
  "unrelated P2002 not treated as webhook dedupe",
);

try {
  evaluateStripeListOutcomeForCheckout({ kind: "verification_failed" });
  throw new Error("verification_failed should throw");
} catch (err) {
  assert(err instanceof BillingCheckoutVerificationError, "stripe list failure → verification error");
}

try {
  evaluateStripeListOutcomeForCheckout({
    kind: "verified",
    subscriptions: [{ id: "sub_x", status: "active", planKey: "premium" }],
  });
  throw new Error("existing sub should block");
} catch (err) {
  assert(err instanceof BillingCheckoutBlockedError, "entitled stripe sub → checkout blocked");
}

evaluateStripeListOutcomeForCheckout({ kind: "verified_empty" });
evaluateStripeListOutcomeForCheckout({ kind: "skipped_no_customer" });

const prevBilling = process.env.SUBSCRIPTION_BILLING_ENABLED;
const prevStripe = process.env.STRIPE_SECRET_KEY;
process.env.SUBSCRIPTION_BILLING_ENABLED = "true";
process.env.STRIPE_SECRET_KEY = "sk_test_mock";

__setListStripeSubscriptionsForCustomerForTests(async () => []);
const empty = await resolveOwnedEntitledStripeSubscriptionsForBusiness("biz_test", "cus_test");
assert(empty.kind === "verified_empty", "mocked stripe list empty → verified_empty");

__setListStripeSubscriptionsForCustomerForTests(async () => {
  throw new Error("stripe timeout");
});
const failed = await resolveOwnedEntitledStripeSubscriptionsForBusiness("biz_test", "cus_test");
assert(failed.kind === "verification_failed", "mocked stripe list error → verification_failed");

__resetListStripeSubscriptionsForCustomerForTests();
process.env.SUBSCRIPTION_BILLING_ENABLED = prevBilling ?? "";
process.env.STRIPE_SECRET_KEY = prevStripe ?? "";

const blockStatuses: SubscriptionStatus[] = [
  SubscriptionStatus.active,
  SubscriptionStatus.trialing,
  SubscriptionStatus.past_due,
  SubscriptionStatus.incomplete,
  SubscriptionStatus.unpaid,
];

for (const status of blockStatuses) {
  const evaluation = evaluateAdminSubscriptionTierChange(
    { stripeSubscriptionId: "sub_test", status, planKey: SubscriptionPlanKey.premium },
    "enterprise",
  );
  assert(!evaluation.allowed, `admin tier blocked for mirror status ${status}`);
}

assert(
  evaluateAdminSubscriptionTierChange(
    { stripeSubscriptionId: "sub_test", status: SubscriptionStatus.canceled, planKey: SubscriptionPlanKey.premium },
    "basic",
  ).allowed,
  "canceled stripe link allows complimentary tier change",
);

try {
  assertAdminSubscriptionTierChangeAllowed(
    { stripeSubscriptionId: "sub_orphan", status: null, planKey: SubscriptionPlanKey.premium },
    "basic",
  );
  throw new Error("missing status with stripe id should block");
} catch (err) {
  assert(err instanceof AdminSubscriptionStripeConflictError, "null status blocks admin change");
}

assertAdminSubscriptionTierChangeAllowed(
  { stripeSubscriptionId: null, status: SubscriptionStatus.active, planKey: SubscriptionPlanKey.enterprise },
  "premium",
);

const prevNode = process.env.NODE_ENV;
process.env.NODE_ENV = "production";
process.env.SUBSCRIPTION_BILLING_ENABLED = "false";
const prodIssues = collectBillingConfigurationIssues();
assert(
  prodIssues.some((i) => i.code === "billing_disabled_in_production"),
  "production warns when billing disabled",
);
process.env.NODE_ENV = prevNode ?? "test";

console.log("subscription-reliability-sprint1-runtime: ok");
