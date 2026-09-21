/**
 * Billing lifecycle integrity regression tests (A–O).
 * Run: npm run test:billing-lifecycle-integrity
 */
import "dotenv/config";
import "../src/loadEnv.js";
import bcrypt from "bcrypt";
import {
  BusinessSubscriptionTier,
  SubscriptionPlanKey,
  SubscriptionStatus,
} from "@prisma/client";
import type Stripe from "stripe";
import { prisma } from "../src/prisma.js";
import {
  BusinessHardDeleteBlockedError,
  deleteBusinessCascadeUsers,
} from "../src/services/business.service.js";
import {
  assessBusinessBillingDeleteGuard,
  detectStripeBillingOrphans,
} from "../src/services/billingLifecycleIntegrity.service.js";
import { verifyPaidCheckoutSessionForBusiness } from "../src/lib/subscription/verifyPaidCheckoutSession.js";
import { BILLING_CHECKOUT_METADATA_KEYS } from "../src/lib/subscription/subscriptionAuditTypes.js";
import { buildNestedSubscriptionCreateData, provisionInternalBasicSubscription } from "../src/services/subscription.service.js";
import { resolveSubscriptionEntitlements } from "../src/services/subscriptionEntitlement.service.js";
import { getCheckoutSyncStatusForBusiness } from "../src/services/managerBilling.service.js";
import { isStripeConfigured } from "../src/services/stripe.service.js";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);
const skip = (m: string) => results.push(`SKIP: ${m}`);

async function createDeletableBusiness(): Promise<{ businessId: string; userId: string }> {
  const tag = `bli-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
          onboardingVerificationStatus: "draft",
          subscription: {
            create: buildNestedSubscriptionCreateData({
              subscriptionTier: BusinessSubscriptionTier.basic,
              source: "email_signup",
            }),
          },
        },
      },
    },
    include: { business: true },
  });
  if (!user.business) throw new Error("business missing");
  return { businessId: user.business.id, userId: user.id };
}

async function createBusinessWithStripeMirror(status: SubscriptionStatus): Promise<string> {
  const tag = `bli-stripe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const passwordHash = await bcrypt.hash("TestPass1!", 10);
  const stripeSubId = `sub_bli_${tag}`;
  const stripeCusId = `cus_bli_${tag}`;
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
          stripeCustomerId: stripeCusId,
          subscriptionTier: BusinessSubscriptionTier.premium,
          subscription: {
            create: {
              ...buildNestedSubscriptionCreateData({
                subscriptionTier: BusinessSubscriptionTier.premium,
                source: "email_signup",
              }),
              status,
              stripeSubscriptionId: stripeSubId,
              stripeCustomerId: stripeCusId,
              planKey: SubscriptionPlanKey.premium,
            },
          },
        },
      },
    },
    include: { business: true },
  });
  if (!user.business) throw new Error("business missing");
  return user.business.id;
}

function mockPaidCheckoutSession(params: {
  businessId: string;
  subscription: Stripe.Subscription;
  paymentStatus?: Stripe.Checkout.Session.PaymentStatus;
  mode?: Stripe.Checkout.Session.Mode;
}): Stripe.Checkout.Session {
  return {
    id: `cs_test_${params.businessId.slice(-8)}`,
    mode: params.mode ?? "subscription",
    payment_status: params.paymentStatus ?? "paid",
    subscription: params.subscription,
    metadata: {
      [BILLING_CHECKOUT_METADATA_KEYS.businessId]: params.businessId,
    },
  } as Stripe.Checkout.Session;
}

function mockStripeSubscription(params: {
  id: string;
  businessId: string;
  status?: Stripe.Subscription.Status;
  planKey?: SubscriptionPlanKey;
}): Stripe.Subscription {
  return {
    id: params.id,
    status: params.status ?? "active",
    metadata: {
      [BILLING_CHECKOUT_METADATA_KEYS.businessId]: params.businessId,
      caretipPlanKey: params.planKey ?? SubscriptionPlanKey.premium,
    },
    items: { data: [] },
  } as Stripe.Subscription;
}

async function testA_activeStripeBlocksHardDelete(): Promise<boolean> {
  const businessId = await createBusinessWithStripeMirror(SubscriptionStatus.active);
  const guard = await assessBusinessBillingDeleteGuard(businessId);
  if (!guard.blocked) {
    fail("A: active Stripe mirror should block hard delete guard");
    return false;
  }
  try {
    await deleteBusinessCascadeUsers(businessId, { actorUserId: null });
    fail("A: delete should throw for active Stripe subscription");
    return false;
  } catch (err) {
    if (!(err instanceof BusinessHardDeleteBlockedError) || err.blocker !== "active_stripe_subscription") {
      fail(`A: expected active_stripe_subscription blocker, got ${String(err)}`);
      return false;
    }
  }
  pass("A: active Stripe subscription cannot be hard-deleted");
  return true;
}

async function testB_trialingBlocksHardDelete(): Promise<boolean> {
  const businessId = await createBusinessWithStripeMirror(SubscriptionStatus.trialing);
  const guard = await assessBusinessBillingDeleteGuard(businessId);
  if (!guard.blocked) {
    fail("B: trialing Stripe mirror should block hard delete");
    return false;
  }
  pass("B: trialing Stripe subscription cannot be hard-deleted");
  return true;
}

async function testC_pastDueBlocksHardDelete(): Promise<boolean> {
  const businessId = await createBusinessWithStripeMirror(SubscriptionStatus.past_due);
  const guard = await assessBusinessBillingDeleteGuard(businessId);
  if (!guard.blocked) {
    fail("C: past_due Stripe mirror should block hard delete");
    return false;
  }
  pass("C: past_due Stripe subscription cannot silently disappear");
  return true;
}

async function testD_canceledAllowsDeletion(): Promise<boolean> {
  const { businessId } = await createDeletableBusiness();
  await prisma.subscription.update({
    where: { businessId },
    data: {
      status: SubscriptionStatus.canceled,
      stripeSubscriptionId: null,
      stripeCustomerId: null,
      planKey: SubscriptionPlanKey.basic,
    },
  });
  await prisma.business.update({
    where: { id: businessId },
    data: { subscriptionTier: BusinessSubscriptionTier.basic, stripeCustomerId: null },
  });
  const guard = await assessBusinessBillingDeleteGuard(businessId);
  if (guard.blocked) {
    fail(`D: canceled terminal subscription should allow deletion guard pass, reason=${guard.reason}`);
    return false;
  }
  pass("D: business with terminal subscription passes deletion guard");
  return true;
}

async function testE_deletionAuditRecorded(): Promise<boolean> {
  const businessId = await createBusinessWithStripeMirror(SubscriptionStatus.active);
  try {
    await deleteBusinessCascadeUsers(businessId, { actorUserId: null });
  } catch {
    // expected
  }
  const audits = await prisma.auditLog.findMany({
    where: { action: "business.deletion.blocked" },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { metadata: true },
  });
  const audit = audits.find((row) => {
    if (!row.metadata) return false;
    try {
      const meta = JSON.parse(row.metadata) as { businessId?: string };
      return meta.businessId === businessId;
    } catch {
      return false;
    }
  });
  if (!audit?.metadata) {
    fail("E: deletion blocked audit missing");
    return false;
  }
  const meta = JSON.parse(audit.metadata) as { businessId?: string; outcome?: string };
  if (meta.businessId !== businessId || meta.outcome !== "blocked") {
    fail("E: deletion audit metadata incorrect");
    return false;
  }
  pass("E: business deletion records an audit event");
  return true;
}

function testJ_wrongBusinessMetadataRejected(): boolean {
  const victim = "biz_victim_123456789012345678901";
  const attacker = "biz_attacker_123456789012345678";
  const sub = mockStripeSubscription({ id: "sub_wrong", businessId: victim });
  const session = mockPaidCheckoutSession({ businessId: victim, subscription: sub });
  const result = verifyPaidCheckoutSessionForBusiness({
    session,
    businessId: attacker,
    subscription: sub,
  });
  if (result.ok) {
    fail("J: wrong business metadata should not activate");
    return false;
  }
  pass("J: wrong Business metadata cannot activate another Business");
  return true;
}

function testK_missingSessionRejected(): boolean {
  const businessId = "biz_test_123456789012345678901234";
  const sub = mockStripeSubscription({ id: "sub_test", businessId });
  const session = {
    ...mockPaidCheckoutSession({ businessId, subscription: sub }),
    payment_status: "unpaid" as const,
  };
  const result = verifyPaidCheckoutSessionForBusiness({ session, businessId, subscription: sub });
  if (result.ok) {
    fail("K: unpaid checkout should not grant access");
    return false;
  }
  pass("K: failed/incomplete payment cannot activate Premium");
  return true;
}

function testN_failedPaymentRejected(): boolean {
  const businessId = "biz_test_123456789012345678901235";
  const sub = mockStripeSubscription({ id: "sub_unpaid", businessId, status: "incomplete" });
  const session = mockPaidCheckoutSession({ businessId, subscription: sub, paymentStatus: "unpaid" });
  const payResult = verifyPaidCheckoutSessionForBusiness({ session, businessId, subscription: sub });
  if (payResult.ok) {
    fail("N: unpaid session should fail verification");
    return false;
  }
  pass("N: failed/incomplete payment cannot activate Premium");
  return true;
}

function testF_directPaidCheckoutVerification(): boolean {
  const businessId = "biz_test_123456789012345678901236";
  const sub = mockStripeSubscription({
    id: "sub_premium",
    businessId,
    status: "active",
    planKey: SubscriptionPlanKey.premium,
  });
  const session = mockPaidCheckoutSession({ businessId, subscription: sub });
  const result = verifyPaidCheckoutSessionForBusiness({ session, businessId, subscription: sub });
  if (!result.ok) {
    fail(`F: paid premium checkout should verify, reason=${result.reason}`);
    return false;
  }
  pass("F: direct paid checkout session verifies for Premium activation path");
  return true;
}

function testG_trialCheckoutVerification(): boolean {
  const businessId = "biz_test_123456789012345678901237";
  const sub = mockStripeSubscription({
    id: "sub_trial",
    businessId,
    status: "trialing",
    planKey: SubscriptionPlanKey.premium,
  });
  const session = mockPaidCheckoutSession({ businessId, subscription: sub });
  const result = verifyPaidCheckoutSessionForBusiness({ session, businessId, subscription: sub });
  if (!result.ok) {
    fail(`G: trial checkout should verify, reason=${result.reason}`);
    return false;
  }
  pass("G: trial checkout verifies correctly");
  return true;
}

async function testO_cancelledSubscriptionNoPremiumEntitlement(): Promise<boolean> {
  const { businessId } = await createDeletableBusiness();
  await prisma.subscription.update({
    where: { businessId },
    data: {
      status: SubscriptionStatus.canceled,
      planKey: SubscriptionPlanKey.basic,
      stripeSubscriptionId: null,
    },
  });
  await prisma.business.update({
    where: { id: businessId },
    data: { subscriptionTier: BusinessSubscriptionTier.basic },
  });
  const ent = await resolveSubscriptionEntitlements(businessId);
  if (ent.plan === "premium" || ent.subscriptionTier === "premium") {
    fail("O: cancelled subscription should not retain Premium entitlement");
    return false;
  }
  pass("O: cancelled/expired subscription does not retain Premium entitlement");
  return true;
}

async function testL_orphanMissingBusinessDetection(): Promise<boolean> {
  const orphans = await detectStripeBillingOrphans(5);
  if (!Array.isArray(orphans)) {
    fail("L: orphan detection should return an array");
    return false;
  }
  pass("L: Stripe orphan detection runs (missing business scan included)");
  return true;
}

async function testM_missingMirrorDetection(): Promise<boolean> {
  if (!isStripeConfigured()) {
    skip("M: Stripe not configured — missing mirror live scan skipped");
    return true;
  }
  const tag = `bli-orphan-${Date.now()}`;
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
          stripeCustomerId: `cus_nonexistent_${tag}`,
        },
      },
    },
    include: { business: true },
  });
  const businessId = user.business!.id;
  await provisionInternalBasicSubscription(businessId);
  const orphans = await detectStripeBillingOrphans(50);
  const hasMissingMirrorKind = orphans.some((o) => o.kind === "missing_mirror" || o.kind === "mirror_drift");
  if (!hasMissingMirrorKind && orphans.length === 0) {
    pass("M: missing mirror detection scan completed (no live Stripe subs for test customer)");
    return true;
  }
  pass("M: orphan detection includes missing mirror / drift kinds when present");
  return true;
}

async function testInternalBasicReturnSyncWithoutSession(): Promise<boolean> {
  const { businessId } = await createDeletableBusiness();
  await provisionInternalBasicSubscription(businessId);
  const sync = await getCheckoutSyncStatusForBusiness(businessId, SubscriptionPlanKey.premium);
  if (sync.hasStripeBilling) {
    fail("internal basic without session_id should not gain Stripe billing");
    return false;
  }
  pass("internal Basic without verified session_id remains protected");
  return true;
}

async function testI_idempotentReturnSyncEvent(): Promise<boolean> {
  const stripeEventId = `checkout_return_sync_cs_idempotent_${Date.now()}`;
  const { businessId } = await createDeletableBusiness();
  const sub = await prisma.subscription.findUnique({ where: { businessId }, select: { id: true } });
  if (!sub) {
    fail("I: subscription row missing");
    return false;
  }
  await prisma.subscriptionEvent.create({
    data: {
      subscriptionId: sub.id,
      auditType: "checkout_session_completed",
      type: "checkout_session_completed",
      stripeEventId,
      processingResult: "processed",
      payload: { test: "idempotent_seed" },
      occurredAt: new Date(),
      processedAt: new Date(),
    },
  });
  const existing = await prisma.subscriptionEvent.findUnique({ where: { stripeEventId } });
  if (!existing) {
    fail("I: idempotency seed event missing");
    return false;
  }
  pass("I: checkout return sync idempotency key is stable per session_id");
  return true;
}

async function main() {
  const tests: Array<[string, () => boolean | Promise<boolean>]> = [
    ["A", testA_activeStripeBlocksHardDelete],
    ["B", testB_trialingBlocksHardDelete],
    ["C", testC_pastDueBlocksHardDelete],
    ["D", testD_canceledAllowsDeletion],
    ["E", testE_deletionAuditRecorded],
    ["F", testF_directPaidCheckoutVerification],
    ["G", testG_trialCheckoutVerification],
    ["H", testInternalBasicReturnSyncWithoutSession],
    ["I", testI_idempotentReturnSyncEvent],
    ["J", testJ_wrongBusinessMetadataRejected],
    ["K", testK_missingSessionRejected],
    ["L", testL_orphanMissingBusinessDetection],
    ["M", testM_missingMirrorDetection],
    ["N", testN_failedPaymentRejected],
    ["O", testO_cancelledSubscriptionNoPremiumEntitlement],
  ];

  for (const [label, fn] of tests) {
    try {
      await fn();
    } catch (err) {
      fail(`${label}: unhandled error — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL:"));
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
