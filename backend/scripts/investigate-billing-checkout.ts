/**
 * Diagnose POST /api/me/billing/checkout failures (no HTTP server required).
 * Run: npm run investigate:billing-checkout
 */
import "dotenv/config";
import "../src/loadEnv.js";
import Stripe from "stripe";
import { SubscriptionStatus } from "@prisma/client";
import { isSubscriptionBillingEnabled } from "../src/config/featureFlags.js";
import { isSubscriptionTrialEnabled, SUBSCRIPTION_TRIAL_PERIOD_DAYS } from "../src/config/subscriptionTrial.js";
import { isStripeConfigured } from "../src/services/stripe.service.js";
import { prisma } from "../src/prisma.js";

const PRICE_KEYS = [
  ["STRIPE_PRICE_BASIC_MONTHLY", "basic", "monthly"],
  ["STRIPE_PRICE_BASIC_YEARLY", "basic", "yearly"],
  ["STRIPE_PRICE_PREMIUM_MONTHLY", "premium", "monthly"],
  ["STRIPE_PRICE_PREMIUM_YEARLY", "premium", "yearly"],
  ["STRIPE_PRICE_ENTERPRISE_MONTHLY", "enterprise", "monthly"],
  ["STRIPE_PRICE_ENTERPRISE_YEARLY", "enterprise", "yearly"],
] as const;

function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

async function checkPrices(stripe: Stripe) {
  section("Stripe Price IDs (env → Stripe API)");
  for (const [envKey, plan, cycle] of PRICE_KEYS) {
    const id = process.env[envKey]?.trim();
    if (!id) {
      console.log(`MISSING ${envKey} (expected ${plan} ${cycle})`);
      continue;
    }
    try {
      const p = await stripe.prices.retrieve(id);
      const interval = p.recurring?.interval ?? "one_time";
      const mismatch = cycle === "monthly" ? interval !== "month" : interval !== "year";
      console.log(
        `${envKey}=${id.slice(-12)} active=${p.active} interval=${interval}${mismatch ? " ⚠ INTERVAL MISMATCH" : ""}`,
      );
    } catch (e) {
      console.log(`${envKey}=${id} ERROR: ${e instanceof Error ? e.message : e}`);
    }
  }
}

async function simulateCheckout(stripe: Stripe, priceId: string, trial: boolean) {
  section(`Simulate Stripe checkout.sessions.create (trial=${trial})`);
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: "cus_simulation_only_will_fail_if_invalid",
      line_items: [{ price: priceId, quantity: 1 }],
      payment_method_collection: "always",
      automatic_tax: { enabled: true },
      tax_id_collection: { enabled: true },
      billing_address_collection: "required",
      customer_update: { address: "auto", name: "auto" },
      success_url: "http://localhost:5173/dashboard/settings?billing=success",
      cancel_url: "http://localhost:5173/dashboard/settings?billing=canceled",
      subscription_data: trial ? { trial_period_days: SUBSCRIPTION_TRIAL_PERIOD_DAYS } : {},
    });
    console.log("Unexpected success (should not happen with fake customer):", session.id);
  } catch (e) {
    if (e instanceof Stripe.errors.StripeError) {
      console.log(`Stripe ${e.type}: ${e.message}`);
      console.log(`param: ${(e as Stripe.errors.StripeInvalidRequestError).param ?? "n/a"}`);
    } else {
      console.log(e instanceof Error ? e.message : e);
    }
  }
}

async function checkSubscriptions() {
  section("Business subscription mirrors (active/trialing)");
  const rows = await prisma.subscription.findMany({
    where: { status: { in: [SubscriptionStatus.active, SubscriptionStatus.trialing] } },
    select: {
      businessId: true,
      status: true,
      planKey: true,
      stripeSubscriptionId: true,
      stripeCustomerId: true,
    },
    take: 10,
  });
  if (rows.length === 0) {
    console.log("No active/trialing subscriptions in DB.");
  } else {
    for (const r of rows) {
      console.log(JSON.stringify(r));
    }
  }
}

async function main() {
  section("Environment flags");
  console.log("SUBSCRIPTION_BILLING_ENABLED=", isSubscriptionBillingEnabled());
  console.log("SUBSCRIPTION_TRIAL_ENABLED (runtime)=", isSubscriptionTrialEnabled());
  console.log("SUBSCRIPTION_TRIAL_PERIOD_DAYS=", SUBSCRIPTION_TRIAL_PERIOD_DAYS);
  console.log("STRIPE configured=", isStripeConfigured());

  if (!isStripeConfigured()) {
    console.error("Cannot continue without STRIPE_SECRET_KEY");
    process.exitCode = 1;
    return;
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!.trim());
  await checkPrices(stripe);
  await checkSubscriptions();

  const premiumMonthly = process.env.STRIPE_PRICE_PREMIUM_MONTHLY?.trim();
  if (premiumMonthly) {
    await simulateCheckout(stripe, premiumMonthly, false);
    await simulateCheckout(stripe, premiumMonthly, true);
  }

  await prisma.$disconnect();
}

void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
