import Stripe from "stripe";
import { isSubscriptionBillingEnabled } from "../config/featureFlags.js";
import {
  createStripeBillingCheckoutSession,
  getStripeClient,
  isStripeConfigured,
} from "./stripe.service.js";
import {
  assertSelfServeCheckoutPlanKey,
} from "../lib/subscription/billingCheckoutPolicy.js";
import { resolveStripeCheckoutPriceId } from "../lib/subscription/stripePricePlanCatalog.js";
import { BILLING_CHECKOUT_METADATA_KEYS } from "../lib/subscription/subscriptionAuditTypes.js";
import { mapBusinessTierToPlanKey } from "../lib/subscription/mapSubscriptionPlanKey.js";
import type { SubscriptionPlanKey } from "@prisma/client";
import { prisma } from "../prisma.js";
import {
  isSubscriptionTrialEnabled,
  SUBSCRIPTION_TRIAL_PERIOD_DAYS,
} from "../config/subscriptionTrial.js";
import { resolveCheckoutFrontendBaseUrl } from "../config/frontendUrl.js";
import {
  assertSelfServeBillingCheckoutAllowed,
  BillingCheckoutVerificationError,
} from "./billingCheckoutGuard.service.js";
import { createHash } from "node:crypto";
import { PaymentOperationBusyError, withPaymentOperationLease } from "../lib/payments/operationLease.js";
import { recordPaymentDiscrepancy } from "./payments/paymentDiscrepancy.service.js";

export type SubscriptionCheckoutFlow = "billing" | "onboarding";

export function checkoutReturnUrls(flow: SubscriptionCheckoutFlow): {
  successUrl: string;
  cancelUrl: string;
} {
  const base = resolveCheckoutFrontendBaseUrl();
  if (flow === "onboarding") {
    return {
      successUrl: `${base}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${base}/subscription/canceled`,
    };
  }
  return {
    successUrl: `${base}/dashboard/settings?billing=success&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${base}/dashboard/settings?billing=canceled`,
  };
}

function logStripeCheckoutFailure(params: {
  planKey: SubscriptionPlanKey;
  billingCycle: "monthly" | "yearly";
  priceId: string;
  err: unknown;
}): void {
  const stripeMsg =
    params.err instanceof Stripe.errors.StripeError
      ? params.err.message
      : params.err instanceof Error
        ? params.err.message
        : String(params.err);
  console.error(
    "[billing.checkout] stripe_session_failed",
    JSON.stringify({
      planKey: params.planKey,
      billingCycle: params.billingCycle,
      resolvedPriceId: params.priceId,
      stripeError: stripeMsg,
      ...(params.err instanceof Stripe.errors.StripeError
        ? { stripeType: params.err.type, stripeCode: params.err.code ?? null }
        : {}),
    }),
  );
}

/** Pro self-serve checkout only (internal planKey `premium`). */
function resolveCheckoutPriceId(planKey: SubscriptionPlanKey, billingCycle: "monthly" | "yearly"): string {
  assertSelfServeCheckoutPlanKey(planKey);
  return resolveStripeCheckoutPriceId(billingCycle);
}

export { stripeCustomerIdempotencyKey } from "./payments/stripeCustomerCreation.service.js";

/**
 * Returns the business's Stripe customer, creating it at most once. Durable, interruption-safe
 * creation lives in payments/stripeCustomerCreation.service.ts (operation row + lease + metadata
 * search before any new key); this wrapper keeps the existing call sites and error contract.
 */
export async function ensureStripeCustomerForBusiness(params: {
  businessId: string;
  email: string;
  businessName: string;
}): Promise<string> {
  if (!isStripeConfigured()) {
    throw new Error("Stripe is not configured");
  }
  const { ensureStripeCustomerCreated, StripeCustomerSetupBusyError } = await import(
    "./payments/stripeCustomerCreation.service.js"
  );
  try {
    return await ensureStripeCustomerCreated(params);
  } catch (err) {
    if (err instanceof StripeCustomerSetupBusyError) {
      throw new BillingCheckoutVerificationError(err.message);
    }
    throw err;
  }
}

/** Create Stripe Checkout Session (mode: subscription). Gated by SUBSCRIPTION_BILLING_ENABLED. */
export async function createPlatformSubscriptionCheckoutSession(params: {
  businessId: string;
  subscriptionId?: string | null;
  managerEmail: string;
  businessName: string;
  planKey: SubscriptionPlanKey;
  billingCycle?: "monthly" | "yearly";
  /** When true, Stripe collects payment details and starts a free trial before the first charge. */
  includeTrial?: boolean;
  /** billing = existing dashboard upgrade flow; onboarding = pricing → signup → onboarding flow. */
  checkoutFlow?: SubscriptionCheckoutFlow;
}): Promise<{ sessionId: string; url: string | null }> {
  if (!isSubscriptionBillingEnabled()) {
    throw new Error("Subscription billing is not enabled");
  }
  if (!isStripeConfigured()) {
    throw new Error("Stripe is not configured");
  }

  assertSelfServeCheckoutPlanKey(params.planKey);

  try {
    return await withPaymentOperationLease(
      `billing_checkout:${params.businessId}`,
      { ttlMs: BILLING_CHECKOUT_LEASE_TTL_MS, waitMs: BILLING_CHECKOUT_LEASE_WAIT_MS },
      () => createPlatformSubscriptionCheckoutSessionLocked(params),
    );
  } catch (err) {
    if (err instanceof PaymentOperationBusyError) {
      throw new BillingCheckoutVerificationError("Checkout is already being prepared. Please try again in a moment.");
    }
    throw err;
  }
}

const BILLING_CHECKOUT_LEASE_TTL_MS = 60_000;
const BILLING_CHECKOUT_LEASE_WAIT_MS = 8_000;

/**
 * Fingerprint of everything that makes a subscription checkout materially different. Equal requests
 * (a double click, a client retry) share it and therefore Stripe's idempotent response; a different
 * plan, cycle, trial choice or return flow gets its own key instead of colliding with the old one.
 */
export function billingCheckoutFingerprint(input: {
  priceId: string;
  planKey: string;
  billingCycle: string;
  trial: boolean;
  customerId: string;
  checkoutFlow: string;
  subscriptionId: string | null;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        input.priceId,
        input.planKey,
        input.billingCycle,
        input.trial,
        input.customerId,
        input.checkoutFlow,
        input.subscriptionId,
      ]),
    )
    .digest("hex")
    .slice(0, 24);
}

/** `previousSessionId` chains to a fresh key when the cached session for a key is no longer open. */
export function billingCheckoutIdempotencyKey(
  businessId: string,
  fingerprint: string,
  previousSessionId: string | null = null,
): string {
  const base = `caretip_billing_checkout_${businessId}_${fingerprint}`;
  return previousSessionId ? `${base}:after:${previousSessionId}` : base;
}

/**
 * Expires this business's other open CareTip subscription checkouts so at most one can ever be
 * completed (a plan or cycle change replaces the earlier session instead of leaving two payable).
 * Best effort: if Stripe cannot be listed, the webhook-side duplicate-subscription check remains.
 */
async function expireOtherOpenBillingCheckouts(params: {
  businessId: string;
  customerId: string;
  keepFingerprint: string;
}): Promise<void> {
  try {
    const stripe = getStripeClient();
    const open = await stripe.checkout.sessions.list({ customer: params.customerId, status: "open", limit: 20 });
    for (const session of open.data) {
      const md = session.metadata ?? {};
      if (session.mode !== "subscription") continue;
      if (md[BILLING_CHECKOUT_METADATA_KEYS.businessId] !== params.businessId) continue;
      if (md[BILLING_CHECKOUT_FINGERPRINT_METADATA_KEY] === params.keepFingerprint) continue;
      try {
        await stripe.checkout.sessions.expire(session.id);
      } catch {
        /* completed or expired meanwhile */
      }
    }
  } catch (err) {
    console.warn("[billing.checkout] open session cleanup skipped", {
      businessId: params.businessId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

const BILLING_CHECKOUT_FINGERPRINT_METADATA_KEY = "caretipCheckoutFingerprint";

async function createPlatformSubscriptionCheckoutSessionLocked(params: {
  businessId: string;
  subscriptionId?: string | null;
  managerEmail: string;
  businessName: string;
  planKey: SubscriptionPlanKey;
  billingCycle?: "monthly" | "yearly";
  includeTrial?: boolean;
  checkoutFlow?: SubscriptionCheckoutFlow;
}): Promise<{ sessionId: string; url: string | null }> {
  await assertSelfServeBillingCheckoutAllowed(params.businessId);

  const billingCycle = params.billingCycle ?? "monthly";
  const priceId = resolveCheckoutPriceId(params.planKey, billingCycle);
  const customerId = await ensureStripeCustomerForBusiness({
    businessId: params.businessId,
    email: params.managerEmail,
    businessName: params.businessName,
  });

  const subscriptionId =
    params.subscriptionId ??
    (
      await prisma.subscription.findUnique({
        where: { businessId: params.businessId },
        select: { id: true },
      })
    )?.id ??
    null;

  const trialEligible =
    params.includeTrial === true &&
    isSubscriptionTrialEnabled() &&
    params.planKey === "premium";
  const subscriptionData: Stripe.Checkout.SessionCreateParams.SubscriptionData = {
    metadata: {
      [BILLING_CHECKOUT_METADATA_KEYS.businessId]: params.businessId,
      ...(subscriptionId
        ? { [BILLING_CHECKOUT_METADATA_KEYS.subscriptionId]: subscriptionId }
        : {}),
      [BILLING_CHECKOUT_METADATA_KEYS.planKey]: params.planKey,
      [BILLING_CHECKOUT_METADATA_KEYS.source]: "platform_checkout",
    },
    ...(trialEligible ? { trial_period_days: SUBSCRIPTION_TRIAL_PERIOD_DAYS } : {}),
  };

  const checkoutFlow = params.checkoutFlow ?? "billing";
  const { successUrl, cancelUrl } = checkoutReturnUrls(checkoutFlow);
  const fingerprint = billingCheckoutFingerprint({
    priceId,
    planKey: params.planKey,
    billingCycle,
    trial: trialEligible,
    customerId,
    checkoutFlow,
    subscriptionId,
  });
  await expireOtherOpenBillingCheckouts({ businessId: params.businessId, customerId, keepFingerprint: fingerprint });

  let session: Stripe.Checkout.Session | null = null;
  let previousSessionId: string | null = null;
  try {
    for (let attempt = 0; attempt < 3 && !session; attempt += 1) {
    const created: Stripe.Checkout.Session = await createStripeBillingCheckoutSession(
      {
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      payment_method_collection: "always",
      // Stripe Tax: net Prices + Dashboard registrations determine VAT/reverse charge — never app rates.
      automatic_tax: { enabled: true },
      tax_id_collection: { enabled: true },
      billing_address_collection: "required",
      customer_update: {
        address: "auto",
        name: "auto",
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
      subscription_data: subscriptionData,
      // Supplement Stripe's native trial UI at the authorize step (Pro trial only).
      ...(trialEligible
        ? {
            custom_text: {
              submit: {
                message:
                  "Your 30-day free Pro trial starts after checkout. Your first payment is charged when the trial ends unless you cancel before then.",
              },
            },
          }
        : {}),
      metadata: {
        [BILLING_CHECKOUT_METADATA_KEYS.businessId]: params.businessId,
        ...(subscriptionId
          ? { [BILLING_CHECKOUT_METADATA_KEYS.subscriptionId]: subscriptionId }
          : {}),
        [BILLING_CHECKOUT_METADATA_KEYS.planKey]: params.planKey,
        [BILLING_CHECKOUT_METADATA_KEYS.source]: "platform_checkout",
        [BILLING_CHECKOUT_FINGERPRINT_METADATA_KEY]: fingerprint,
      },
    },
      {
        idempotencyKey: billingCheckoutIdempotencyKey(params.businessId, fingerprint, previousSessionId),
      },
    );
    // Stripe replays the stored response for a reused key. If that session was completed or has
    // expired, chain to a new key derived from it (deterministic, so concurrent retries agree).
    if (!created.status || created.status === "open") {
      session = created;
    } else {
      previousSessionId = created.id;
    }
    }
  } catch (err) {
    logStripeCheckoutFailure({
      planKey: params.planKey,
      billingCycle,
      priceId,
      err,
    });
    throw err;
  }

  if (!session) {
    throw new BillingCheckoutVerificationError("Checkout could not be started. Please try again shortly.");
  }
  return { sessionId: session.id, url: session.url };
}

/** Stripe Customer Portal session (scaffold — API route in Phase B.2). */
export type BillingPortalFlow = "default" | "payment_methods";

export async function createBillingPortalSession(params: {
  stripeCustomerId: string;
  returnUrl?: string;
  flow?: BillingPortalFlow;
}): Promise<{ url: string }> {
  if (!isSubscriptionBillingEnabled()) {
    throw new Error("Subscription billing is not enabled");
  }
  const stripe = getStripeClient();
  const flow = params.flow ?? "default";
  const session = await stripe.billingPortal.sessions.create({
    customer: params.stripeCustomerId,
    return_url: params.returnUrl ?? `${resolveCheckoutFrontendBaseUrl()}/dashboard/billing/subscription`,
    ...(flow === "payment_methods"
      ? { flow_data: { type: "payment_method_update" as const } }
      : {}),
  });
  return { url: session.url };
}

/** Schedule cancel at period end via Stripe API (scaffold). */
export async function scheduleStripeSubscriptionCancelAtPeriodEnd(
  stripeSubscriptionId: string,
): Promise<Stripe.Subscription> {
  if (!isSubscriptionBillingEnabled()) {
    throw new Error("Subscription billing is not enabled");
  }
  const stripe = getStripeClient();
  return stripe.subscriptions.update(stripeSubscriptionId, {
    cancel_at_period_end: true,
  });
}

/** Sync planKey on mirror before checkout from business tier if needed. */
export function planKeyForBusinessTier(tier: Parameters<typeof mapBusinessTierToPlanKey>[0]): SubscriptionPlanKey {
  return mapBusinessTierToPlanKey(tier);
}
