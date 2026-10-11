/**
 * Phase B.1 implementation — loaded only after isolated Postgres bootstrap.
 */
import {
  BillingCycle,
  BusinessSubscriptionTier,
  SubscriptionEventProcessingResult,
  SubscriptionPlanKey,
  SubscriptionStatus,
} from "@prisma/client";
import type Stripe from "stripe";
import { prisma } from "../src/prisma.js";
import { buildNestedSubscriptionCreateData } from "../src/services/subscription.service.js";
import {
  applyStripeMirrorTransactional,
  ensureInitialSubscriptionMirrorFromStripe,
  resolveBusinessTierDualWrite,
  type StripeMirrorSnapshot,
} from "../src/services/subscription.service.js";
import { resolveSubscriptionEntitlements } from "../src/services/subscriptionEntitlement.service.js";
import {
  handleStripeBillingWebhookEvent,
  isStripeBillingEventType,
  isSubscriptionCheckoutSession,
} from "../src/services/stripeBillingWebhook.service.js";
import { acquireBillingWebhookProcessingClaim } from "../src/services/billingWebhookProcessingClaim.service.js";
import { STRIPE_BILLING_AUDIT_TYPES } from "../src/lib/subscription/subscriptionAuditTypes.js";
import bcrypt from "bcrypt";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

function futureDate(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function pastDate(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function baseSnapshot(overrides: Partial<StripeMirrorSnapshot> = {}): StripeMirrorSnapshot {
  return {
    stripeSubscriptionId: "sub_test_b1",
    stripeCustomerId: "cus_test_b1",
    stripePriceId: "price_premium_monthly",
    planKey: SubscriptionPlanKey.premium,
    status: SubscriptionStatus.active,
    billingCycle: BillingCycle.monthly,
    currentPeriodStart: pastDate(10),
    currentPeriodEnd: futureDate(20),
    renewalDate: futureDate(20),
    cancelAtPeriodEnd: false,
    canceledAt: null,
    cancellationEffective: null,
    trialStartedAt: null,
    trialEndsAt: null,
    trialSource: null,
    isTrial: false,
    trialExpiredAt: null,
    ...overrides,
  };
}

function testProcessingResultEnum(): boolean {
  const values = Object.values(SubscriptionEventProcessingResult);
  if (values.includes("pending" as SubscriptionEventProcessingResult)) {
    fail("SubscriptionEventProcessingResult must not include pending");
    return false;
  }
  for (const expected of ["processed", "ignored", "failed", "processing"] as const) {
    if (!values.includes(expected)) {
      fail(`SubscriptionEventProcessingResult missing ${expected}`);
      return false;
    }
  }
  pass("SubscriptionEventProcessingResult: processed | ignored | failed | processing");
  return true;
}

function testResolveBusinessTierCancelAtPeriodEnd(): boolean {
  const snapshot = baseSnapshot({
    cancelAtPeriodEnd: true,
    cancellationEffective: futureDate(14),
    currentPeriodEnd: futureDate(14),
  });
  const tier = resolveBusinessTierDualWrite(snapshot);
  if (tier !== null) {
    fail("cancel_at_period_end (future): expected null tier update (preserve premium)");
    return false;
  }
  pass("cancel_at_period_end (future): tier dual-write skipped — premium preserved");
  return true;
}

function testResolveBusinessTierAfterPeriodEnd(): boolean {
  const snapshot = baseSnapshot({
    cancelAtPeriodEnd: true,
    cancellationEffective: pastDate(1),
    currentPeriodEnd: pastDate(1),
    status: SubscriptionStatus.canceled,
  });
  const tier = resolveBusinessTierDualWrite(snapshot);
  if (tier !== BusinessSubscriptionTier.basic) {
    fail(`after period end: expected basic, got ${String(tier)}`);
    return false;
  }
  pass("cancel_at_period_end (past): tier downgrades to basic");
  return true;
}

function testWebhookRoutingHelpers(): boolean {
  const subSession = { mode: "subscription" } as Stripe.Checkout.Session;
  const paySession = { mode: "payment" } as Stripe.Checkout.Session;
  if (!isSubscriptionCheckoutSession(subSession)) {
    fail("isSubscriptionCheckoutSession should be true for mode=subscription");
    return false;
  }
  if (isSubscriptionCheckoutSession(paySession)) {
    fail("isSubscriptionCheckoutSession should be false for mode=payment");
    return false;
  }
  if (!isStripeBillingEventType("customer.subscription.updated")) {
    fail("customer.subscription.updated should be a billing event type");
    return false;
  }
  if (isStripeBillingEventType("payment_intent.succeeded")) {
    fail("payment_intent.succeeded should not be a billing event type");
    return false;
  }
  pass("webhook routing helpers: subscription vs payment checkout split");
  return true;
}

async function testBillingDisabledNoOp(): Promise<boolean> {
  const prev = process.env.SUBSCRIPTION_BILLING_ENABLED;
  process.env.SUBSCRIPTION_BILLING_ENABLED = "false";

  const event = {
    id: `evt_b1_disabled_${Date.now()}`,
    type: "customer.subscription.updated",
    data: { object: {} },
  } as Stripe.Event;

  const result = await handleStripeBillingWebhookEvent(event);
  process.env.SUBSCRIPTION_BILLING_ENABLED = prev;

  if (!result.billingDisabled) {
    fail("billing disabled: expected billingDisabled flag");
    return false;
  }
  pass("SUBSCRIPTION_BILLING_ENABLED=false: billing webhook no-op");
  return true;
}

async function createTestBusiness(tier: BusinessSubscriptionTier): Promise<{ businessId: string; subscriptionId: string }> {
  const tag = `b1-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
          subscriptionTier: tier,
          subscription: {
            create: buildNestedSubscriptionCreateData({
              subscriptionTier: tier,
              source: "email_signup",
            }),
          },
        },
      },
    },
    include: { business: { include: { subscription: true } } },
  });

  if (!user.business?.subscription) {
    throw new Error("subscription mirror missing after create");
  }
  return { businessId: user.business.id, subscriptionId: user.business.subscription.id };
}

async function testMirrorCancelPreservesTier(): Promise<boolean> {
  const { businessId, subscriptionId } = await createTestBusiness(BusinessSubscriptionTier.premium);
  const snapshot = baseSnapshot({
    stripeSubscriptionId: `sub_b1_${subscriptionId}`,
    stripeCustomerId: `cus_b1_${subscriptionId}`,
    planKey: SubscriptionPlanKey.premium,
    cancelAtPeriodEnd: true,
    cancellationEffective: futureDate(30),
    currentPeriodEnd: futureDate(30),
  });

  await applyStripeMirrorTransactional({
    subscriptionRowId: subscriptionId,
    businessId,
    snapshot,
    auditType: STRIPE_BILLING_AUDIT_TYPES.subscriptionUpdated,
    stripeEventId: `evt_b1_cancel_${Date.now()}`,
    auditPayload: { test: "cancel_at_period_end" },
  });

  const row = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      subscriptionTier: true,
      subscription: {
        select: { cancelAtPeriodEnd: true, planKey: true, status: true },
      },
    },
  });

  if (!row?.subscription) {
    fail("mirror cancel: subscription row missing");
    return false;
  }
  if (row.subscriptionTier !== BusinessSubscriptionTier.premium) {
    fail(`mirror cancel (future): tier should stay premium, got ${row.subscriptionTier}`);
    return false;
  }
  if (!row.subscription.cancelAtPeriodEnd) {
    fail("mirror cancel: cancelAtPeriodEnd not set on mirror");
    return false;
  }
  pass("applyStripeMirrorTransactional: cancel_at_period_end preserves Business.subscriptionTier");
  return true;
}

async function testBillingWebhookFailedAllowsRetry(): Promise<boolean> {
  const stripeEventId = `evt_b1_failed_retry_${Date.now()}`;

  await prisma.subscriptionEvent.create({
    data: {
      subscriptionId: null,
      auditType: STRIPE_BILLING_AUDIT_TYPES.subscriptionUpdated,
      type: STRIPE_BILLING_AUDIT_TYPES.subscriptionUpdated,
      stripeEventId,
      processingResult: SubscriptionEventProcessingResult.failed,
      processingError: "simulated_failure",
      payload: { test: "failed_retry" },
      occurredAt: new Date(),
      processedAt: new Date(),
    },
  });

  const claim = await acquireBillingWebhookProcessingClaim(stripeEventId);
  if (claim.action !== "acquired") {
    fail("failed billing webhook row should be reclaimed for Stripe retry");
    return false;
  }

  const row = await prisma.subscriptionEvent.findUnique({ where: { stripeEventId } });
  if (row?.processingResult !== SubscriptionEventProcessingResult.processing) {
    fail("failed row should transition to processing claim on retry");
    return false;
  }
  if (row.processingClaimToken !== claim.claimToken) {
    fail("reclaimed row should carry new claim token");
    return false;
  }

  pass("billing webhook: failed processing row reclaimed with durable claim");
  return true;
}

async function testBillingWebhookIdempotency(): Promise<boolean> {
  const { subscriptionId } = await createTestBusiness(BusinessSubscriptionTier.basic);
  const stripeEventId = `evt_b1_dup_${Date.now()}`;

  await prisma.subscriptionEvent.create({
    data: {
      subscriptionId,
      auditType: STRIPE_BILLING_AUDIT_TYPES.subscriptionUpdated,
      type: STRIPE_BILLING_AUDIT_TYPES.subscriptionUpdated,
      stripeEventId,
      processingResult: SubscriptionEventProcessingResult.processed,
      payload: { test: "seed" },
      occurredAt: new Date(),
      processedAt: new Date(),
    },
  });

  const prev = process.env.SUBSCRIPTION_BILLING_ENABLED;
  process.env.SUBSCRIPTION_BILLING_ENABLED = "true";

  const event = {
    id: stripeEventId,
    type: "customer.subscription.updated",
    data: { object: { id: "sub_should_not_run" } },
  } as Stripe.Event;

  const result = await handleStripeBillingWebhookEvent(event);
  process.env.SUBSCRIPTION_BILLING_ENABLED = prev;

  if (!result.duplicate) {
    fail("billing idempotency: duplicate stripe_event_id should short-circuit");
    return false;
  }
  pass("billing idempotency: subscription_events.stripe_event_id duplicate skipped");
  return true;
}

async function testOptionAInitialMirrorCreate(): Promise<boolean> {
  const tag = `b1-opta-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
          subscriptionTier: null,
        },
      },
    },
    include: { business: true },
  });

  const businessId = user.business!.id;
  const before = await prisma.subscription.findUnique({ where: { businessId } });
  if (before) {
    fail("Option A test: business should have no subscription row before webhook create");
    return false;
  }

  const snapshot = baseSnapshot({
    stripeSubscriptionId: `sub_opta_${tag}`,
    stripeCustomerId: `cus_opta_${tag}`,
    planKey: SubscriptionPlanKey.premium,
    status: SubscriptionStatus.trialing,
    isTrial: true,
    trialStartedAt: pastDate(1),
    trialEndsAt: futureDate(28),
  });

  const stripeEventId = `evt_opta_${Date.now()}`;
  const ensured = await ensureInitialSubscriptionMirrorFromStripe({
    businessId,
    snapshot,
    auditType: STRIPE_BILLING_AUDIT_TYPES.subscriptionCreated,
    stripeEventId,
    auditPayload: { test: "option_a_create" },
  });

  if (!ensured.created) {
    fail("Option A: first ensureInitialSubscriptionMirrorFromStripe should create mirror");
    return false;
  }

  const entitlements = await resolveSubscriptionEntitlements(businessId);
  if (!entitlements.hasActiveEntitlements || entitlements.plan !== SubscriptionPlanKey.premium) {
    fail("Option A: entitlements should be premium trialing after mirror create");
    return false;
  }
  if (entitlements.status !== SubscriptionStatus.trialing) {
    fail(`Option A: expected trialing status, got ${entitlements.status}`);
    return false;
  }

  const ensuredAgain = await ensureInitialSubscriptionMirrorFromStripe({
    businessId,
    snapshot,
    auditType: STRIPE_BILLING_AUDIT_TYPES.subscriptionUpdated,
    stripeEventId: `evt_opta_dup_${Date.now()}`,
    auditPayload: { test: "option_a_idempotent" },
  });

  if (ensuredAgain.created) {
    fail("Option A: second ensureInitialSubscriptionMirrorFromStripe must not duplicate mirror");
    return false;
  }

  const mirrorCount = await prisma.subscription.count({ where: { businessId } });
  if (mirrorCount !== 1) {
    fail(`Option A: expected exactly one mirror row, got ${mirrorCount}`);
    return false;
  }

  pass("Option A: ensureInitialSubscriptionMirrorFromStripe creates entitled mirror idempotently");
  return true;
}

async function testTransactionNoP2028(): Promise<boolean> {
  const { businessId, subscriptionId } = await createTestBusiness(BusinessSubscriptionTier.basic);
  const snapshot = baseSnapshot({
    stripeSubscriptionId: `sub_b1_tx_${subscriptionId}`,
    stripeCustomerId: `cus_b1_tx_${subscriptionId}`,
    planKey: SubscriptionPlanKey.premium,
    status: SubscriptionStatus.active,
  });

  try {
    await applyStripeMirrorTransactional({
      subscriptionRowId: subscriptionId,
      businessId,
      snapshot,
      auditType: STRIPE_BILLING_AUDIT_TYPES.subscriptionCreated,
      stripeEventId: `evt_b1_tx_${Date.now()}`,
      auditPayload: { test: "transaction" },
    });
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "P2028") {
      fail("Prisma transaction P2028 on applyStripeMirrorTransactional");
      return false;
    }
    throw err;
  }

  pass("applyStripeMirrorTransactional: Prisma $transaction completed (no P2028)");
  return true;
}

export async function runSubscriptionB1Runtime(): Promise<void> {
  let ok = true;
  ok = testProcessingResultEnum() && ok;
  ok = testResolveBusinessTierCancelAtPeriodEnd() && ok;
  ok = testResolveBusinessTierAfterPeriodEnd() && ok;
  ok = testWebhookRoutingHelpers() && ok;
  ok = (await testBillingDisabledNoOp()) && ok;
  ok = (await testMirrorCancelPreservesTier()) && ok;
  ok = (await testBillingWebhookIdempotency()) && ok;
  ok = (await testBillingWebhookFailedAllowsRetry()) && ok;
  ok = (await testOptionAInitialMirrorCreate()) && ok;
  ok = (await testTransactionNoP2028()) && ok;

  console.log("Phase B.1 Stripe billing lifecycle runtime checks (isolated DB)\n");
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
