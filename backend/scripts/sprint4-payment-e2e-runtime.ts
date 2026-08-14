/**
 * Sprint 4 — full revenue path validation (checkout webhook → ledger → idempotency).
 * Run: npm run test:sprint4-payment-e2e
 */
import "dotenv/config";
import "../src/loadEnv.js";
import Stripe from "stripe";
import { prisma } from "../src/prisma.js";
import {
  handleSuccessfulTipPayment,
  verifyWebhookSignature,
  isStripeConfigured,
  __setPaymentIntentsRetrieveFnForTests,
  __setConnectedAccountRetrieveFnForTests,
  __setRefundsCreateFnForTests,
} from "../src/services/stripe.service.js";
import {
  isStripeWebhookEventProcessed,
  markStripeWebhookEventProcessed,
} from "../src/services/stripeWebhookIdempotency.service.js";
import { assertEmployeeEligibleForTipPayment } from "../src/services/tipPaymentEligibility.service.js";
import bcrypt from "bcrypt";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);
const skip = (m: string) => results.push(`SKIP: ${m}`);

async function seedVerifiedVenue() {
  const tag = Date.now();
  const email = `sprint4-pay-${tag}@caretip-test.local`;
  const passwordHash = await bcrypt.hash("TestPass1!", 10);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      role: "MANAGER",
      emailVerified: true,
      hasCompletedOnboarding: true,
      business: {
        create: {
          name: `Sprint4 Pay Venue ${tag}`,
          slug: `sprint4-pay-${tag}`,
          verificationStatus: "verified",
          onboardingVerificationStatus: "approved",
          operationalStatus: "active",
          subscriptionTier: "premium",
          stripeAccountId: `acct_sprint4_${tag}`,
          stripeConnectStatus: "ready",
          stripeChargesEnabled: true,
          stripePayoutsEnabled: true,
        },
      },
    },
    include: { business: true },
  });
  const empUser = await prisma.user.create({
    data: {
      email: `sprint4-emp-${tag}@caretip-test.local`,
      passwordHash,
      role: "EMPLOYEE",
      emailVerified: true,
      employee: {
        create: {
          name: "Sprint4 Tip Staff",
          slug: `sprint4-staff-${tag}`,
          jobTitle: "Server",
          businessId: user.business!.id,
          isActive: true,
          activationStatus: "active",
        },
      },
    },
    include: { employee: true },
  });
  return {
    businessId: user.business!.id,
    employeeId: empUser.employee!.id,
    stripeAccountId: user.business!.stripeAccountId!,
    cleanup: async () => {
      await prisma.transaction.deleteMany({ where: { businessId: user.business!.id } });
      await prisma.employee.deleteMany({ where: { businessId: user.business!.id } });
      await prisma.business.delete({ where: { id: user.business!.id } }).catch(() => {});
      await prisma.user.deleteMany({
        where: { id: { in: [user.id, empUser.id] } },
      });
    },
  };
}

async function main() {
  if (!isStripeConfigured()) {
    skip("STRIPE_SECRET_KEY not set — webhook signature test skipped");
  }

  let venue: Awaited<ReturnType<typeof seedVerifiedVenue>> | null = null;
  try {
    venue = await seedVerifiedVenue();
    pass("seed verified business + active employee");

    await assertEmployeeEligibleForTipPayment(venue.employeeId, venue.businessId);
    pass("pre-payment eligibility");

    const piId = `pi_sprint4_test_${Date.now()}`;
    __setRefundsCreateFnForTests(async () => ({ id: `re_s4_${Date.now()}`, object: "refund", status: "succeeded" } as Stripe.Refund));
    __setPaymentIntentsRetrieveFnForTests(async (id) => ({
      id,
      object: "payment_intent",
      amount: 500,
      amount_received: 500,
      currency: "eur",
      status: "succeeded",
      application_fee_amount: 99,
      transfer_data: { destination: venue.stripeAccountId },
    } as Stripe.PaymentIntent));
    __setConnectedAccountRetrieveFnForTests(async (id) => ({
      id,
      charges_enabled: true,
      payouts_enabled: true,
    }));
    const session = {
      id: `cs_sprint4_test_${Date.now()}`,
      payment_status: "paid",
      currency: "eur",
      payment_intent: piId,
      amount_total: 500,
      metadata: {
        employeeId: venue.employeeId,
        businessId: venue.businessId,
        source: "sprint4_e2e",
      },
    } as Stripe.Checkout.Session;

    await handleSuccessfulTipPayment(session);
    const tx = await prisma.transaction.findFirst({
      where: { stripePaymentIntentId: piId },
    });
    if (tx?.status === "success" && Number(tx.amount) === 5) {
      pass("webhook handler created success transaction (€5.00)");
    } else {
      fail(`transaction missing or wrong: ${JSON.stringify(tx)}`);
    }

    await handleSuccessfulTipPayment(session);
    const dupCount = await prisma.transaction.count({
      where: { stripePaymentIntentId: piId },
    });
    if (dupCount === 1) pass("duplicate webhook did not double-credit");
    else fail(`expected 1 transaction, got ${dupCount}`);

    if (process.env.STRIPE_WEBHOOK_SECRET?.trim()) {
      const eventPayload = JSON.stringify({
        id: `evt_sprint4_${Date.now()}`,
        object: "event",
        type: "checkout.session.completed",
        data: { object: session },
      });
      const raw = Buffer.from(eventPayload);
      const sig = Stripe.webhooks.generateTestHeaderString({
        payload: eventPayload,
        secret: process.env.STRIPE_WEBHOOK_SECRET.trim(),
      });
      const evt = verifyWebhookSignature(raw, sig);
      if (evt.type === "checkout.session.completed") pass("Stripe signature verification round-trip");
      else fail("signature verify wrong event type");
    } else {
      skip("STRIPE_WEBHOOK_SECRET not set");
    }

    const evtId = `evt_sprint4_idem_${Date.now()}`;
    if (!(await isStripeWebhookEventProcessed(evtId))) {
      await markStripeWebhookEventProcessed(evtId, "checkout.session.completed");
      if (await isStripeWebhookEventProcessed(evtId)) pass("event idempotency store");
      else fail("event idempotency mark failed");
      await prisma.stripeWebhookEvent.delete({ where: { id: evtId } }).catch(() => {});
    }
  } catch (e) {
    fail(`runtime error: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    __setPaymentIntentsRetrieveFnForTests(null);
    __setConnectedAccountRetrieveFnForTests(null);
    __setRefundsCreateFnForTests(null);
    if (venue) await venue.cleanup();
  }

  const failed = results.filter((r) => r.startsWith("FAIL:"));
  console.log(results.join("\n"));
  console.log(failed.length === 0 ? "OVERALL: PASS" : "OVERALL: FAIL");
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
