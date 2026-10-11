import { isSubscriptionBillingEnabled } from "./featureFlags.js";
import { isStripeConfigured } from "../services/stripe.service.js";
import {
  STRIPE_CHECKOUT_PRICE_ENV_KEYS,
  stripeCheckoutPriceEnvKey,
  normalizeStripePriceIdEnv,
} from "../lib/subscription/stripePricePlanCatalog.js";

export type BillingConfigurationIssue = {
  code: string;
  message: string;
};

/** Non-secret configuration checks for operators (code defaults ≠ Render env). */
export function collectBillingConfigurationIssues(): BillingConfigurationIssue[] {
  const issues: BillingConfigurationIssue[] = [];
  const nodeEnv = process.env.NODE_ENV?.trim() || "development";
  const billingEnabled = isSubscriptionBillingEnabled();
  const stripeConfigured = isStripeConfigured();

  if (nodeEnv === "production" && !billingEnabled) {
    issues.push({
      code: "billing_disabled_in_production",
      message:
        "SUBSCRIPTION_BILLING_ENABLED is not true — SaaS checkout and billing webhooks are disabled (verify Render env; code default is off).",
    });
  }

  if (billingEnabled && !stripeConfigured) {
    issues.push({
      code: "billing_enabled_without_stripe",
      message:
        "SUBSCRIPTION_BILLING_ENABLED is true but STRIPE_SECRET_KEY is missing — billing cannot run.",
    });
  }

  if (billingEnabled && stripeConfigured) {
    for (const cycle of ["monthly", "yearly"] as const) {
      const envKey = stripeCheckoutPriceEnvKey(cycle);
      const priceId = normalizeStripePriceIdEnv(process.env[envKey]);
      if (!priceId) {
        issues.push({
          code: `missing_${envKey.toLowerCase()}`,
          message: `${envKey} is not set — Pro ${cycle} self-serve checkout will fail.`,
        });
      }
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
    if (!webhookSecret) {
      issues.push({
        code: "missing_stripe_webhook_secret",
        message:
          "STRIPE_WEBHOOK_SECRET is not set — Stripe webhooks (including billing) will reject signatures.",
      });
    }
  }

  return issues;
}

export function logBillingConfigurationDiagnostics(): void {
  const issues = collectBillingConfigurationIssues();
  if (issues.length === 0) {
    if (isSubscriptionBillingEnabled()) {
      console.info("[billing.config] Subscription billing enabled; required env keys present.");
    }
    return;
  }

  for (const issue of issues) {
    console.warn(`[billing.config] ${issue.code}: ${issue.message}`);
  }

  const unsetPriceKeys = STRIPE_CHECKOUT_PRICE_ENV_KEYS.filter(
    (key) => !normalizeStripePriceIdEnv(process.env[key]),
  );
  if (unsetPriceKeys.length > 0 && isSubscriptionBillingEnabled()) {
    console.warn(
      "[billing.config] unset_price_env_keys",
      unsetPriceKeys.join(", "),
    );
  }
}
