/**
 * Verify configured Stripe Pro billing prices are active and match product-truth net amounts.
 * Does not create or modify Stripe Prices.
 * Run: npm run verify:stripe-billing-prices
 */
import "dotenv/config";
import "../src/loadEnv.js";
import Stripe from "stripe";
import { isStripeConfigured } from "../src/services/stripe.service.js";
import {
  normalizeStripePriceIdEnv,
  STRIPE_CHECKOUT_PRICE_ENV_KEYS,
  type StripeCheckoutPriceEnvKey,
} from "../src/lib/subscription/stripePricePlanCatalog.js";
import {
  PRO_NET_MONTHLY_EUR_CENTS,
  PRO_NET_YEARLY_EUR_CENTS,
} from "../src/lib/subscription/proSubscriptionNetPricing.js";

const EXPECTED_NET_CENTS: Record<StripeCheckoutPriceEnvKey, number> = {
  STRIPE_PRICE_PREMIUM_MONTHLY: PRO_NET_MONTHLY_EUR_CENTS,
  STRIPE_PRICE_PREMIUM_YEARLY: PRO_NET_YEARLY_EUR_CENTS,
};

const EXPECTED_INTERVAL: Record<StripeCheckoutPriceEnvKey, "month" | "year"> = {
  STRIPE_PRICE_PREMIUM_MONTHLY: "month",
  STRIPE_PRICE_PREMIUM_YEARLY: "year",
};

async function main(): Promise<void> {
  if (!isStripeConfigured()) {
    console.error("FAIL: STRIPE_SECRET_KEY is not configured.");
    process.exitCode = 1;
    return;
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!.trim());
  let failed = 0;

  for (const envKey of STRIPE_CHECKOUT_PRICE_ENV_KEYS) {
    const priceId = normalizeStripePriceIdEnv(process.env[envKey]);
    if (!priceId) {
      console.error(`FAIL: ${envKey} is not set (required for Pro checkout).`);
      failed += 1;
      continue;
    }
    try {
      const price = await stripe.prices.retrieve(priceId);
      if (!price.active) {
        console.error(`FAIL: ${envKey} → ${priceId} is INACTIVE in Stripe`);
        failed += 1;
        continue;
      }

      const expectedCents = EXPECTED_NET_CENTS[envKey];
      const expectedInterval = EXPECTED_INTERVAL[envKey];
      const amountOk = price.unit_amount === expectedCents;
      const currencyOk = price.currency === "eur";
      const intervalOk = price.recurring?.interval === expectedInterval;
      const taxBehavior = price.tax_behavior ?? "unspecified";

      if (!amountOk || !currencyOk || !intervalOk) {
        console.error(
          `FAIL: ${envKey} → ${priceId} amount/interval mismatch (got ${price.unit_amount} ${price.currency}/${price.recurring?.interval}, expected ${expectedCents} eur/${expectedInterval})`,
        );
        failed += 1;
        continue;
      }

      console.log(
        `OK:   ${envKey} → ${priceId} (active, €${(expectedCents / 100).toFixed(2)} net/${expectedInterval}, tax_behavior=${taxBehavior})`,
      );
      if (taxBehavior !== "exclusive") {
        console.warn(
          `WARN: ${envKey} tax_behavior is "${taxBehavior}" — Fanny should set exclusive net Prices in Stripe Dashboard for Stripe Tax.`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`FAIL: ${envKey} → ${priceId} (${msg})`);
      failed += 1;
    }
  }

  if (failed > 0) {
    console.error(
      `\n${failed} price(s) need attention. Align Stripe Dashboard Prices to €29.00/month and €278.40/year net (exclusive), then update STRIPE_PRICE_PREMIUM_* if IDs change. This script does not create Prices.`,
    );
    process.exitCode = 1;
  } else {
    console.log("\nPro checkout prices (STRIPE_PRICE_PREMIUM_*) are active and match product-truth net amounts.");
  }
}

void main();
