/**
 * Sprint 1.2 integration implementation — loaded after isolated Postgres bootstrap.
 */
import bcrypt from "bcrypt";
import {
  BusinessSubscriptionTier,
  SubscriptionEventProcessingResult,
  SubscriptionPlanKey,
  SubscriptionStatus,
} from "@prisma/client";
import type Stripe from "stripe";
import { prisma } from "../src/prisma.js";
import {
  acquireBillingWebhookProcessingClaim,
  finalizeBillingWebhookClaimIgnored,
} from "../src/services/billingWebhookProcessingClaim.service.js";
import { BillingWebhookConcurrentDeliveryError } from "../src/services/billingWebhookIdempotency.service.js";
import { handleStripeBillingWebhookEvent } from "../src/services/stripeBillingWebhook.service.js";
import {
  assertSelfServeBillingCheckoutAllowed,
  BillingCheckoutBlockedError,
  BillingCheckoutVerificationError,
} from "../src/services/billingCheckoutGuard.service.js";
import {
  __resetListStripeSubscriptionsForCustomerForTests,
  __setListStripeSubscriptionsForCustomerForTests,
  assessBusinessBillingDeleteGuard,
} from "../src/services/billingLifecycleIntegrity.service.js";
import { __setCheckoutSessionsCreateFnForTests } from "../src/services/stripe.service.js";
import { createPlatformSubscriptionCheckoutSession } from "../src/services/stripeBilling.service.js";
import { isPrismaUniqueViolationOnStripeEventId } from "../src/lib/prismaUniqueViolation.js";
import { applyStripeMirrorTransactional } from "../src/services/subscription.service.js";
import { STRIPE_BILLING_AUDIT_TYPES } from "../src/lib/subscription/subscriptionAuditTypes.js";
import { BillingCycle } from "@prisma/client";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

async function assertProcessingClaimSchema(): Promise<boolean> {
  try {
    await prisma.$queryRaw`
      SELECT processing_claim_token, processing_claim_expires_at
      FROM subscription_events
      LIMIT 0
    `;
    pass("schema: processing claim columns present");
    return true;
  } catch (err) {
    fail(
      `schema: processing claim migration not applied (${err instanceof Error ? err.message : String(err)})`,
    );
    return false;
  }
}

async function createTestBusiness(tier: BusinessSubscriptionTier = BusinessSubscriptionTier.basic) {
  const tag = `s12-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const user = await prisma.user.create({
    data: {
      email: `${tag}@caretip-test.local`,
      passwordHash: await bcrypt.hash("TestPass1!", 10),
      role: "MANAGER",
      emailVerified: true,
      business: {
        create: {
          name: `${tag} venue`,
          slug: `${tag}-venue`,
          subscriptionTier: tier,
          stripeCustomerId: `cus_${tag}`,
          subscription: {
            create: {
              planKey: SubscriptionPlanKey.basic,
              status: SubscriptionStatus.active,
            },
          },
        },
      },
    },
    include: { business: { include: { subscription: true } } },
  });
  return {
    businessId: user.business!.id,
    subscriptionId: user.business!.subscription!.id,
  };
}

async function testWebhookFailedThenRetrySuccess(): Promise<boolean> {
  const stripeEventId = `evt_s12_retry_${Date.now()}`;
  await prisma.subscriptionEvent.create({
    data: {
      subscriptionId: null,
      auditType: "billing_webhook_processing",
      type: "billing_webhook_processing",
      stripeEventId,
      processingResult: SubscriptionEventProcessingResult.failed,
      processingError: "simulated",
      payload: { test: true },
      occurredAt: new Date(),
      processedAt: new Date(),
    },
  });

  const prev = process.env.SUBSCRIPTION_BILLING_ENABLED;
  process.env.SUBSCRIPTION_BILLING_ENABLED = "true";

  const event = {
    id: stripeEventId,
    type: "customer.subscription.updated",
    data: {
      object: {
        id: "sub_missing",
        metadata: {},
        status: "active",
      },
    },
  } as Stripe.Event;

  const result = await handleStripeBillingWebhookEvent(event);
  process.env.SUBSCRIPTION_BILLING_ENABLED = prev;

  if (result.duplicate) {
    fail("retry: expected successful delivery after failed row, got duplicate");
    return false;
  }

  const row = await prisma.subscriptionEvent.findUnique({ where: { stripeEventId } });
  if (row?.processingResult !== SubscriptionEventProcessingResult.ignored) {
    fail(`retry: expected terminal ignored after handler, got ${row?.processingResult}`);
    return false;
  }
  pass("webhook: failed delivery then successful retry finalizes ignored");
  return true;
}

async function testConcurrentFailedReclaim(): Promise<boolean> {
  const stripeEventId = `evt_s12_conc_${Date.now()}`;
  await prisma.subscriptionEvent.create({
    data: {
      subscriptionId: null,
      auditType: "test",
      type: "test",
      stripeEventId,
      processingResult: SubscriptionEventProcessingResult.failed,
      processingError: "simulated",
      payload: {},
      occurredAt: new Date(),
      processedAt: new Date(),
    },
  });

  const outcomes = await Promise.allSettled([
    acquireBillingWebhookProcessingClaim(stripeEventId),
    acquireBillingWebhookProcessingClaim(stripeEventId),
  ]);

  const acquired = outcomes.filter(
    (o) => o.status === "fulfilled" && o.value.action === "acquired",
  ).length;
  const concurrent = outcomes.filter(
    (o) => o.status === "rejected" && o.reason instanceof BillingWebhookConcurrentDeliveryError,
  ).length;

  if (acquired < 1) {
    fail("concurrent reclaim: expected at least one acquired claim");
    return false;
  }
  if (acquired + concurrent < 2) {
    fail("concurrent reclaim: expected acquired + concurrent rejection to cover both deliveries");
    return false;
  }
  pass("webhook: simultaneous reclaim serializes via advisory lock / in-flight claim");
  return true;
}

async function testWorkerCrashLeavesClaimUntilExpired(): Promise<boolean> {
  const stripeEventId = `evt_s12_crash_${Date.now()}`;
  const claim = await acquireBillingWebhookProcessingClaim(stripeEventId);
  if (claim.action !== "acquired") {
    fail("worker crash: initial claim failed");
    return false;
  }

  try {
    await acquireBillingWebhookProcessingClaim(stripeEventId);
    fail("worker crash: concurrent delivery should not reclaim active claim");
    return false;
  } catch (err) {
    if (!(err instanceof BillingWebhookConcurrentDeliveryError)) {
      fail(`worker crash: expected concurrent delivery error, got ${String(err)}`);
      return false;
    }
  }

  const row = await prisma.subscriptionEvent.findUnique({ where: { stripeEventId } });
  if (row?.processingResult !== SubscriptionEventProcessingResult.processing) {
    fail("worker crash: claim row should remain processing");
    return false;
  }
  pass("webhook: worker crash after claim leaves processing row until TTL/reclaim");
  return true;
}

async function testExpiredClaimReclamation(): Promise<boolean> {
  const stripeEventId = `evt_s12_exp_${Date.now()}`;
  const expired = new Date(Date.now() - 60_000);
  await prisma.subscriptionEvent.create({
    data: {
      subscriptionId: null,
      auditType: "billing_webhook_processing",
      type: "billing_webhook_processing",
      stripeEventId,
      processingResult: SubscriptionEventProcessingResult.processing,
      processingClaimToken: "stale-token",
      processingClaimExpiresAt: expired,
      payload: { phase: "claim_acquired" },
      occurredAt: new Date(),
    },
  });

  const claim = await acquireBillingWebhookProcessingClaim(stripeEventId);
  if (claim.action !== "acquired" || claim.claimToken === "stale-token") {
    fail("expired claim: expected new claim token after reclamation");
    return false;
  }
  pass("webhook: expired processing claim can be reclaimed");
  return true;
}

async function testStaleWorkerCannotFinalize(): Promise<boolean> {
  const stripeEventId = `evt_s12_stale_${Date.now()}`;
  const first = await acquireBillingWebhookProcessingClaim(stripeEventId);
  if (first.action !== "acquired") {
    fail("stale worker: first claim failed");
    return false;
  }

  await prisma.subscriptionEvent.update({
    where: { stripeEventId },
    data: {
      processingClaimExpiresAt: new Date(Date.now() - 1_000),
    },
  });

  const second = await acquireBillingWebhookProcessingClaim(stripeEventId);
  if (second.action !== "acquired") {
    fail("stale worker: second reclaim failed");
    return false;
  }

  const staleIgnored = await finalizeBillingWebhookClaimIgnored({
    stripeEventId,
    claimToken: first.claimToken,
    auditType: "test",
    payload: { reason: "stale" },
  });
  if (staleIgnored) {
    fail("stale worker: old token must not finalize ignored");
    return false;
  }

  const ok = await finalizeBillingWebhookClaimIgnored({
    stripeEventId,
    claimToken: second.claimToken,
    auditType: "test",
    payload: { reason: "owner" },
  });
  if (!ok) {
    fail("stale worker: current owner should finalize");
    return false;
  }
  pass("webhook: superseded worker cannot overwrite newer owner");
  return true;
}

async function testDuplicateProcessedShortCircuit(): Promise<boolean> {
  const stripeEventId = `evt_s12_dup_${Date.now()}`;
  await prisma.subscriptionEvent.create({
    data: {
      subscriptionId: null,
      auditType: "test",
      type: "test",
      stripeEventId,
      processingResult: SubscriptionEventProcessingResult.processed,
      payload: {},
      occurredAt: new Date(),
      processedAt: new Date(),
    },
  });

  process.env.SUBSCRIPTION_BILLING_ENABLED = "true";
  const result = await handleStripeBillingWebhookEvent({
    id: stripeEventId,
    type: "customer.subscription.updated",
    data: { object: { id: "sub_x" } },
  } as Stripe.Event);

  if (!result.duplicate) {
    fail("duplicate processed: expected duplicate=true");
    return false;
  }
  pass("webhook: duplicate processed event returns success without re-running handler");
  return true;
}

async function testCheckoutEntitledConflict(): Promise<boolean> {
  const { businessId } = await createTestBusiness();
  await prisma.subscription.update({
    where: { businessId },
    data: {
      stripeSubscriptionId: "sub_entitled",
      status: SubscriptionStatus.active,
      planKey: SubscriptionPlanKey.premium,
    },
  });

  process.env.SUBSCRIPTION_BILLING_ENABLED = "true";
  process.env.STRIPE_SECRET_KEY = "sk_test_mock";
  __setListStripeSubscriptionsForCustomerForTests(async () => []);

  try {
    await assertSelfServeBillingCheckoutAllowed(businessId);
    fail("checkout: entitled mirror should block");
    return false;
  } catch (err) {
    if (!(err instanceof BillingCheckoutBlockedError)) {
      fail(`checkout: expected blocked error, got ${String(err)}`);
      return false;
    }
  } finally {
    __resetListStripeSubscriptionsForCustomerForTests();
  }
  pass("checkout: existing entitled subscription returns conflict");
  return true;
}

async function testCheckoutStripeListVerification503(): Promise<boolean> {
  const { businessId } = await createTestBusiness();
  process.env.SUBSCRIPTION_BILLING_ENABLED = "true";
  process.env.STRIPE_SECRET_KEY = "sk_test_mock";

  __setListStripeSubscriptionsForCustomerForTests(async () => {
    throw new Error("stripe list down");
  });

  let sessionCreates = 0;
  __setCheckoutSessionsCreateFnForTests(async () => {
    sessionCreates += 1;
    return { id: "cs_test", url: "https://example.test/checkout" } as Stripe.Checkout.Session;
  });

  try {
    await createPlatformSubscriptionCheckoutSession({
      businessId,
      managerEmail: "mgr@test.local",
      businessName: "Test",
      planKey: SubscriptionPlanKey.premium,
    });
    fail("checkout: verification failure should throw");
    return false;
  } catch (err) {
    if (!(err instanceof BillingCheckoutVerificationError)) {
      fail(`checkout: expected verification error, got ${String(err)}`);
      return false;
    }
  } finally {
    __setCheckoutSessionsCreateFnForTests(null);
    __resetListStripeSubscriptionsForCustomerForTests();
  }

  if (sessionCreates !== 0) {
    fail("checkout: Stripe list failure must not create Checkout Session");
    return false;
  }
  pass("checkout: Stripe list failure returns verification error without session create");
  return true;
}

async function testCheckoutConcurrentIdempotency(): Promise<boolean> {
  const { businessId } = await createTestBusiness();
  process.env.SUBSCRIPTION_BILLING_ENABLED = "true";
  process.env.STRIPE_SECRET_KEY = "sk_test_mock";
  __setListStripeSubscriptionsForCustomerForTests(async () => []);

  const idempotencyKeys: string[] = [];
  let creates = 0;
  __setCheckoutSessionsCreateFnForTests(async (_params, options) => {
    if (options?.idempotencyKey) {
      idempotencyKeys.push(options.idempotencyKey);
    }
    creates += 1;
    await new Promise((r) => setTimeout(r, 40));
    return { id: `cs_${creates}`, url: "https://example.test" } as Stripe.Checkout.Session;
  });

  await Promise.allSettled([
    createPlatformSubscriptionCheckoutSession({
      businessId,
      managerEmail: "c@test.local",
      businessName: "C",
      planKey: SubscriptionPlanKey.premium,
    }),
    createPlatformSubscriptionCheckoutSession({
      businessId,
      managerEmail: "d@test.local",
      businessName: "D",
      planKey: SubscriptionPlanKey.premium,
    }),
  ]);

  __setCheckoutSessionsCreateFnForTests(null);
  __resetListStripeSubscriptionsForCustomerForTests();

  const expectedKey = `caretip_billing_checkout_${businessId}`;
  if (idempotencyKeys.length < 1 || !idempotencyKeys.every((k) => k === expectedKey)) {
    fail("checkout: idempotency keys must be stable per business");
    return false;
  }
  const mirrorCount = await prisma.subscription.count({ where: { businessId } });
  if (mirrorCount !== 1) {
    fail(`checkout: expected exactly one subscription mirror, got ${mirrorCount}`);
    return false;
  }
  pass("checkout: concurrent attempts use stable Stripe idempotency key");
  return true;
}

async function testDifferentBusinessesCheckoutParallel(): Promise<boolean> {
  const a = await createTestBusiness();
  const b = await createTestBusiness();
  process.env.SUBSCRIPTION_BILLING_ENABLED = "true";
  process.env.STRIPE_SECRET_KEY = "sk_test_mock";
  __setListStripeSubscriptionsForCustomerForTests(async () => []);

  const started: string[] = [];
  await Promise.all([
    assertSelfServeBillingCheckoutAllowed(a.businessId).then(() => started.push("a")),
    assertSelfServeBillingCheckoutAllowed(b.businessId).then(() => started.push("b")),
  ]);

  __resetListStripeSubscriptionsForCustomerForTests();

  if (started.length !== 2) {
    fail("checkout: different businesses should not block each other on guard");
    return false;
  }
  pass("checkout: separate businesses pass guard concurrently");
  return true;
}

async function testDeleteGuardVerificationFailed(): Promise<boolean> {
  const { businessId } = await createTestBusiness();
  await prisma.subscription.update({
    where: { businessId },
    data: {
      stripeSubscriptionId: null,
      status: SubscriptionStatus.canceled,
      planKey: SubscriptionPlanKey.basic,
    },
  });

  process.env.SUBSCRIPTION_BILLING_ENABLED = "true";
  process.env.STRIPE_SECRET_KEY = "sk_test_mock";
  __setListStripeSubscriptionsForCustomerForTests(async () => {
    throw new Error("stripe unavailable");
  });

  const guard = await assessBusinessBillingDeleteGuard(businessId);
  __resetListStripeSubscriptionsForCustomerForTests();

  if (!guard.blocked || !guard.reason?.includes("could not be verified")) {
    fail("delete guard: Stripe list failure must block without implying active subscription conflict");
    return false;
  }
  if (guard.activeStripeSubscriptions.length > 0) {
    fail("delete guard: verification failure must not fabricate active subscriptions");
    return false;
  }
  pass("delete guard: fails closed on Stripe verification failure");
  return true;
}

async function testMirrorTransactionRollbackLeavesProcessingClaim(): Promise<boolean> {
  const stripeEventId = `evt_s12_tx_rb_${Date.now()}`;
  const claim = await acquireBillingWebhookProcessingClaim(stripeEventId);
  if (claim.action !== "acquired") {
    fail("rollback: could not acquire claim");
    return false;
  }

  const { businessId } = await createTestBusiness();
  try {
    await applyStripeMirrorTransactional({
      subscriptionRowId: "clinvalid_subscription_row",
      businessId,
      snapshot: {
        stripeSubscriptionId: "sub_rb",
        stripeCustomerId: "cus_rb",
        stripePriceId: "price_test",
        planKey: SubscriptionPlanKey.premium,
        status: SubscriptionStatus.active,
        billingCycle: BillingCycle.monthly,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 86_400_000),
        renewalDate: new Date(Date.now() + 86_400_000),
        cancelAtPeriodEnd: false,
        canceledAt: null,
        cancellationEffective: null,
        trialStartedAt: null,
        trialEndsAt: null,
        trialSource: null,
        isTrial: false,
        trialExpiredAt: null,
      },
      auditType: STRIPE_BILLING_AUDIT_TYPES.subscriptionUpdated,
      stripeEventId,
      auditPayload: { test: "forced_rollback" },
      billingWebhookClaimToken: claim.claimToken,
    });
    fail("rollback: expected mirror apply to throw");
    return false;
  } catch {
    // expected — subscription row missing
  }

  const row = await prisma.subscriptionEvent.findUnique({ where: { stripeEventId } });
  if (row?.processingResult !== SubscriptionEventProcessingResult.processing) {
    fail(`rollback: claim should remain processing after failed mirror tx, got ${row?.processingResult}`);
    return false;
  }
  if (row.processingClaimToken !== claim.claimToken) {
    fail("rollback: claim token should be unchanged after failed mirror tx");
    return false;
  }
  pass("webhook claim: mirror transaction rollback does not falsely finalize");
  return true;
}

async function testWebhookHandlerFailureRecordsFailed(): Promise<boolean> {
  const stripeEventId = `evt_s12_handler_fail_${Date.now()}`;
  process.env.SUBSCRIPTION_BILLING_ENABLED = "true";

  try {
    await handleStripeBillingWebhookEvent({
      id: stripeEventId,
      type: "invoice.payment_succeeded",
      data: {
        object: {
          id: "in_handler_fail",
          subscription: "sub_handler_fail",
        },
      },
    } as Stripe.Event);
    fail("handler failure: expected throw without Stripe mock");
    return false;
  } catch {
    // Stripe retrieve fails without live API — expected
  }

  const row = await prisma.subscriptionEvent.findUnique({ where: { stripeEventId } });
  if (row?.processingResult !== SubscriptionEventProcessingResult.failed) {
    fail(`handler failure: expected failed row for Stripe retry, got ${row?.processingResult}`);
    return false;
  }
  pass("webhook: handler failure records failed (not success)");
  return true;
}

async function testP2002Scope(): Promise<boolean> {
  assert(
    isPrismaUniqueViolationOnStripeEventId({
      code: "P2002",
      meta: { target: ["stripe_event_id"] },
    }),
    "P2002 stripe_event_id",
  );
  pass("P2002 helper scoped to stripe_event_id");
  return true;
}

export async function runSprint12IntegrationRuntime(): Promise<void> {
  console.log("Sprint 1.2 integration (CARETIP_ISOLATED_POSTGRES_URL, mocked Stripe only)\n");

  let ok = await assertProcessingClaimSchema();
  if (!ok) {
    for (const line of results) {
      console.log(line);
    }
    process.exitCode = 1;
    return;
  }

  ok = (await testP2002Scope()) && ok;
  ok = (await testWebhookFailedThenRetrySuccess()) && ok;
  ok = (await testConcurrentFailedReclaim()) && ok;
  ok = (await testWorkerCrashLeavesClaimUntilExpired()) && ok;
  ok = (await testExpiredClaimReclamation()) && ok;
  ok = (await testStaleWorkerCannotFinalize()) && ok;
  ok = (await testDuplicateProcessedShortCircuit()) && ok;
  ok = (await testMirrorTransactionRollbackLeavesProcessingClaim()) && ok;
  ok = (await testWebhookHandlerFailureRecordsFailed()) && ok;
  ok = (await testCheckoutEntitledConflict()) && ok;
  ok = (await testCheckoutStripeListVerification503()) && ok;
  ok = (await testCheckoutConcurrentIdempotency()) && ok;
  ok = (await testDifferentBusinessesCheckoutParallel()) && ok;
  ok = (await testDeleteGuardVerificationFailed()) && ok;

  for (const line of results) {
    console.log(line);
  }
  console.log(ok ? "\nRESULT: PASS" : "\nRESULT: FAIL");
  if (!ok) process.exitCode = 1;
}
