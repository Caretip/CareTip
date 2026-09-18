/**
 * Pro Stripe Tax checkout readiness locks (static + entitlement; no live Checkout create).
 * Run: npm run test:pro-stripe-tax --prefix backend
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BillingCycle, SubscriptionPlanKey, SubscriptionStatus } from "@prisma/client";
import { SUBSCRIPTION_TRIAL_PERIOD_DAYS } from "../src/config/subscriptionTrial.js";
import { isSubscriptionMirrorEntitled } from "../src/lib/subscription/subscriptionMirrorEntitlement.js";
import {
  PRO_NET_MONTHLY_EUR_CENTS,
  PRO_NET_YEARLY_EUR_CENTS,
} from "../src/lib/subscription/proSubscriptionNetPricing.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function read(rel: string): string {
  const abs = path.join(root, rel);
  if (!existsSync(abs)) throw new Error(`missing file: ${rel}`);
  return readFileSync(abs, "utf8");
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

assert(PRO_NET_MONTHLY_EUR_CENTS === 2900, "Pro monthly net must be €29.00 (2900 cents)");
assert(PRO_NET_YEARLY_EUR_CENTS === 27840, "Pro annual net must be €278.40 (27840 cents)");
assert(PRO_NET_YEARLY_EUR_CENTS !== 29000, "Pro annual must not be the legacy €290 TEST amount");

const billing = read("backend/src/services/stripeBilling.service.ts");
assert(billing.includes("automatic_tax: { enabled: true }"), "monthly/annual Checkout must enable automatic_tax");
assert(billing.includes("tax_id_collection: { enabled: true }"), "Checkout must collect tax/VAT IDs");
assert(billing.includes('billing_address_collection: "required"'), "Checkout must collect billing address for Tax");
assert(billing.includes("customer_update:"), "Checkout must allow customer address/name updates for Tax");
assert(billing.includes('address: "auto"'), "customer_update.address auto required");
assert(billing.includes('name: "auto"'), "customer_update.name auto required");
assert(billing.includes("trial_period_days: SUBSCRIPTION_TRIAL_PERIOD_DAYS"), "30-day trial path preserved");
assert(billing.includes('payment_method_collection: "always"'), "payment method collection preserved");
assert(billing.includes("resolveStripeCheckoutPriceId"), "Checkout uses env Price IDs only");
assert(!billing.includes("unit_amount"), "Checkout must not embed client/unit amounts");
assert(!/0\.19|taxRate\s*=|VAT_RATE|34\.51|331\.30/.test(billing), "no app-side VAT calculation in checkout");

assert(SUBSCRIPTION_TRIAL_PERIOD_DAYS === 30, `trial days must be 30, got ${SUBSCRIPTION_TRIAL_PERIOD_DAYS}`);

const catalog = read("backend/src/lib/subscription/stripePricePlanCatalog.ts");
assert(catalog.includes("STRIPE_PRICE_PREMIUM_MONTHLY"), "monthly Price env key present");
assert(catalog.includes("STRIPE_PRICE_PREMIUM_YEARLY"), "yearly Price env key present");

const verifyScript = read("backend/scripts/verify-stripe-billing-prices.ts");
assert(verifyScript.includes("PRO_NET_MONTHLY_EUR_CENTS"), "verify script locks €29 net");
assert(verifyScript.includes("PRO_NET_YEARLY_EUR_CENTS"), "verify script locks €278.40 net");
assert(!verifyScript.includes("29000"), "verify must not expect €290 yearly");

const netPricing = read("backend/src/lib/subscription/proSubscriptionNetPricing.ts");
assert(netPricing.includes("27840"), "product-truth yearly cents is 27840");
assert(netPricing.includes("2900"), "product-truth monthly cents is 2900");
assert(!netPricing.includes("29000"), "product-truth must not use €290 yearly");

const entitlement = isSubscriptionMirrorEntitled({
  status: SubscriptionStatus.active,
  cancelAtPeriodEnd: false,
  cancellationEffective: null,
  currentPeriodEnd: null,
  canceledAt: null,
});
assert(entitlement === true, "active subscription remains entitled (tax-agnostic)");

const trialing = isSubscriptionMirrorEntitled({
  status: SubscriptionStatus.trialing,
  cancelAtPeriodEnd: false,
  cancellationEffective: null,
  currentPeriodEnd: null,
  canceledAt: null,
});
assert(trialing === true, "trialing subscription remains entitled");

const webhook = read("backend/src/services/stripeBillingWebhook.service.ts");
assert(webhook.includes("amountPaid: invoice.amount_paid"), "invoice amount is audit-only");
assert(webhook.includes("buildMirrorSnapshotFromStripeSubscription"), "mirror from Subscription object");
assert(!/tax_amount|total_tax_amounts|automatic_tax/.test(webhook), "webhooks must not gate entitlement on tax fields");
assert(webhook.includes("isSubscriptionMirrorEntitled"), "payment_failed still uses status entitlement");

const en = read("src/i18n/locales/en.json");
const de = read("src/i18n/locales/de.json");
assert(en.includes("€29 / month"), "EN monthly net display");
assert(en.includes("€278.40 / year"), "EN annual net display");
assert(en.includes("gridLegalNote"), "EN grid legal note key");
assert(en.includes("billed annually (€278.40/yr)"), "EN Pro annual billing hint");
assert(en.includes("Unlimited Tables / QR Codes"), "EN Basic unlimited tables copy");
assert(!en.includes("€290"), "EN must not advertise €290");
assert(de.includes("29 € / Monat"), "DE monthly net display");
assert(de.includes("278,40 € / Jahr"), "DE annual net display");
assert(de.includes("gridLegalNote"), "DE grid legal note key");
assert(!de.includes("290 €"), "DE must not advertise €290");

const frontendPricing = read("src/app/data/proSubscriptionNetPricing.ts");
assert(frontendPricing.includes("278.4"), "frontend net yearly constant");
assert(frontendPricing.includes("29"), "frontend net monthly constant");

const pricingConfig = read("src/app/data/pricingConfig.ts");
assert(pricingConfig.includes("PRO_NET_MONTHLY_DISPLAY_EN"), "pricingConfig uses net monthly constant");

// Sanity: plan keys used by checkout remain premium-only for self-serve
assert(billing.includes('params.planKey === "premium"'), "trial remains Pro-only");
void BillingCycle;
void SubscriptionPlanKey;

console.log("pro-stripe-tax-checkout-runtime: ok");
