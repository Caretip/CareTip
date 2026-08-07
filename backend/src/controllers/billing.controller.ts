import type { Request, Response } from "express";
import { SubscriptionPlanKey } from "@prisma/client";
import Stripe from "stripe";
import * as businessService from "../services/business.service.js";
import { prisma } from "../prisma.js";
import { isSubscriptionBillingEnabled } from "../config/featureFlags.js";
import { isSubscriptionTrialEnabled } from "../config/subscriptionTrial.js";
import { assertTrialCheckoutAllowed } from "../services/trialEligibility.service.js";
import {
  BASIC_CHECKOUT_NOT_REQUIRED_MESSAGE,
  ENTERPRISE_CHECKOUT_CONTACT_SALES_MESSAGE,
  BillingCheckoutNotAllowedError,
} from "../lib/subscription/billingCheckoutPolicy.js";
import {
  createManagerCheckoutSession,
  createManagerPortalSession,
  getBillingStatusForBusiness,
  getBillingTimelineForBusiness,
  getCheckoutSyncStatusForBusiness,
  scheduleManagerCancelAtPeriodEnd,
} from "../services/managerBilling.service.js";
import { isStripeConfigured } from "../services/stripe.service.js";
import { resolveSubscriptionEntitlements } from "../services/subscriptionEntitlement.service.js";
import { CLIENT_FALLBACK, clientSafeMessage, logServerError } from "../utils/httpErrors.js";
import {
  normalizeStripePriceIdEnv,
  stripeCheckoutPriceEnvKey,
} from "../lib/subscription/stripePricePlanCatalog.js";

function getUserId(req: Request): string | null {
  const uid = req.user?.userId ?? req.user?.id;
  return typeof uid === "string" && uid.trim() ? uid.trim() : null;
}

function parsePlanKey(raw: unknown): SubscriptionPlanKey | null {
  if (raw === "basic" || raw === "premium" || raw === "enterprise") return raw;
  return null;
}

function parseBillingCycle(raw: unknown): "monthly" | "yearly" | undefined {
  if (raw === "monthly" || raw === "yearly") return raw;
  return undefined;
}

const CHECKOUT_INACTIVE_PRICE_MESSAGE =
  "This plan is temporarily unavailable for checkout. The Stripe price is inactive — reactivate it in the Stripe Dashboard or update the price ID in server configuration.";

function checkoutClientMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("inactive") && msg.toLowerCase().includes("price")) {
    return CHECKOUT_INACTIVE_PRICE_MESSAGE;
  }
  if (msg.includes("Stripe price not configured")) {
    return "Subscription billing is not fully configured for this plan. Please contact support.";
  }
  return clientSafeMessage(err, CLIENT_FALLBACK.generic);
}

/** Temporary investigation logging — prints immediately before checkout HTTP 400 responses. */
function logCheckout400(reason: string, details: Record<string, unknown>): void {
  console.error(`[billing.checkout] 400 ${reason}`, JSON.stringify(details, null, 2));
}

function resolveConfiguredPriceId(
  planKey: SubscriptionPlanKey,
  billingCycle: "monthly" | "yearly",
): string | null {
  if (planKey !== "premium") return null;
  const envKey = stripeCheckoutPriceEnvKey(billingCycle);
  return normalizeStripePriceIdEnv(process.env[envKey]) ?? null;
}

function stripeErrorDetails(err: unknown): Record<string, unknown> {
  if (err instanceof Stripe.errors.StripeError) {
    return {
      stripeType: err.type,
      stripeCode: err.code ?? null,
      stripeParam: err instanceof Stripe.errors.StripeInvalidRequestError ? err.param ?? null : null,
      stripeMessage: err.message,
    };
  }
  return {};
}

type ManagerBusinessContext =
  | {
      ok: true;
      userId: string;
      businessId: string;
      email: string;
      businessName: string;
    }
  | { ok: false; status: number; message: string };

async function resolveManagerBusiness(req: Request): Promise<ManagerBusinessContext> {
  const userId = getUserId(req);
  if (!userId) return { ok: false, status: 401, message: "Authentication required" };

  const business = await businessService.getBusinessByUserId(userId);
  if (!business) {
    return { ok: false, status: 404, message: "Business not found" };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  if (!user?.email) {
    return { ok: false, status: 404, message: "User not found" };
  }

  return {
    ok: true,
    userId,
    businessId: business.id,
    email: user.email,
    businessName: business.name,
  };
}

export async function getMyBilling(req: Request, res: Response) {
  try {
    const ctx = await resolveManagerBusiness(req);
    if (!ctx.ok) {
      return res.status(ctx.status).json({ message: ctx.message });
    }

    const status = await getBillingStatusForBusiness(ctx.businessId);
    const events = await getBillingTimelineForBusiness(ctx.businessId);

    return res.json({ ...status, events });
  } catch (err) {
    logServerError("billing.getMyBilling", err);
    return res.status(500).json({ message: clientSafeMessage(err, CLIENT_FALLBACK.generic) });
  }
}

function parseCheckoutFlow(raw: unknown): "billing" | "onboarding" | undefined {
  if (raw === "billing" || raw === "onboarding") return raw;
  return undefined;
}

export async function getMyBillingSyncStatus(req: Request, res: Response) {
  try {
    const ctx = await resolveManagerBusiness(req);
    if (!ctx.ok) {
      return res.status(ctx.status).json({ message: ctx.message });
    }

    const expectedPlan = parsePlanKey(req.query.expectedPlan);
    const checkoutSessionId =
      typeof req.query.session_id === "string" ? req.query.session_id.trim() : null;
    const status = await getCheckoutSyncStatusForBusiness(
      ctx.businessId,
      expectedPlan ?? undefined,
      { checkoutSessionId: checkoutSessionId || null },
    );
    return res.json(status);
  } catch (err) {
    logServerError("billing.getMyBillingSyncStatus", err);
    return res.status(500).json({ message: clientSafeMessage(err, CLIENT_FALLBACK.generic) });
  }
}

export async function postMyBillingCheckout(req: Request, res: Response) {
  const requestBody = (req.body ?? {}) as Record<string, unknown>;
  let businessId: string | null = null;
  let planKey: SubscriptionPlanKey | null = null;
  let billingCycle: "monthly" | "yearly" | undefined;
  let includeTrial = false;
  let checkoutFlow: "billing" | "onboarding" | undefined;

  try {
    const ctx = await resolveManagerBusiness(req);
    if (!ctx.ok) {
      return res.status(ctx.status).json({ message: ctx.message });
    }
    businessId = ctx.businessId;

    const entitlements = await resolveSubscriptionEntitlements(ctx.businessId);
    if (entitlements.accessSource === "sponsored") {
      return res.status(403).json({
        message: "Checkout is not available while sponsored access is active.",
      });
    }

    planKey = parsePlanKey(requestBody.planKey);
    if (!planKey) {
      logCheckout400("invalid_plan_key", {
        validation: "planKey must be basic, premium, or enterprise",
        receivedBody: requestBody,
        receivedPlanKey: requestBody.planKey,
        receivedBillingCycle: requestBody.billingCycle,
        receivedIncludeTrial: requestBody.includeTrial,
        note: "successUrl and cancelUrl are not accepted from the client; they are set server-side in stripeBilling.service.ts",
      });
      return res.status(400).json({ message: "planKey must be basic, premium, or enterprise" });
    }

    if (planKey === "basic") {
      logCheckout400("basic_checkout_blocked", { businessId: ctx.businessId, planKey });
      return res.status(400).json({ message: BASIC_CHECKOUT_NOT_REQUIRED_MESSAGE });
    }

    if (planKey === "enterprise") {
      logCheckout400("enterprise_checkout_blocked", { businessId: ctx.businessId, planKey });
      return res.status(400).json({ message: ENTERPRISE_CHECKOUT_CONTACT_SALES_MESSAGE });
    }

    billingCycle = parseBillingCycle(requestBody.billingCycle);
    includeTrial = requestBody.includeTrial === true;
    checkoutFlow = parseCheckoutFlow(requestBody.checkoutFlow);
    const billingCycleResolved = billingCycle ?? "monthly";
    const priceEnvKey =
      planKey === "premium" ? stripeCheckoutPriceEnvKey(billingCycleResolved) : null;
    const configuredPriceId = resolveConfiguredPriceId(planKey, billingCycleResolved);

    const mirror = await prisma.subscription.findUnique({
      where: { businessId: ctx.businessId },
      select: {
        id: true,
        status: true,
        planKey: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
        trialEndsAt: true,
        isTrial: true,
      },
    });

    console.info(
      "[billing.checkout] attempt",
      JSON.stringify({
        businessId: ctx.businessId,
        planKey,
        billingCycle: billingCycleResolved,
        includeTrial,
        checkoutFlow: checkoutFlow ?? "billing",
        subscriptionTrialEnabled: isSubscriptionTrialEnabled(),
        subscriptionBillingEnabled: isSubscriptionBillingEnabled(),
        stripeConfigured: isStripeConfigured(),
        priceEnvKey,
        configuredPriceId,
        mirror: mirror
          ? {
              id: mirror.id,
              status: mirror.status,
              planKey: mirror.planKey,
              stripeCustomerId: mirror.stripeCustomerId,
              stripeSubscriptionId: mirror.stripeSubscriptionId,
              isTrial: mirror.isTrial,
              trialEndsAt: mirror.trialEndsAt?.toISOString() ?? null,
            }
          : null,
        clientFields: {
          planKey: requestBody.planKey,
          billingCycle: requestBody.billingCycle ?? null,
          includeTrial: requestBody.includeTrial ?? null,
          successUrl: requestBody.successUrl ?? null,
          cancelUrl: requestBody.cancelUrl ?? null,
        },
        serverUrls: {
          successUrl:
            checkoutFlow === "onboarding"
              ? `${(process.env.FRONTEND_URL ?? "http://localhost:5173").replace(/\/$/, "")}/subscription/success?session_id={CHECKOUT_SESSION_ID}`
              : `${(process.env.FRONTEND_URL ?? "http://localhost:5173").replace(/\/$/, "")}/dashboard/settings?billing=success&session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl:
            checkoutFlow === "onboarding"
              ? `${(process.env.FRONTEND_URL ?? "http://localhost:5173").replace(/\/$/, "")}/subscription/canceled`
              : `${(process.env.FRONTEND_URL ?? "http://localhost:5173").replace(/\/$/, "")}/dashboard/settings?billing=canceled`,
        },
      }),
    );

    if (includeTrial) {
      await assertTrialCheckoutAllowed(ctx.businessId, planKey);
    }

    const session = await createManagerCheckoutSession({
      businessId: ctx.businessId,
      managerEmail: ctx.email,
      businessName: ctx.businessName,
      planKey,
      billingCycle,
      includeTrial,
      checkoutFlow: checkoutFlow ?? "billing",
    });

    return res.json(session);
  } catch (err) {
    logServerError("billing.postMyBillingCheckout", err);
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof BillingCheckoutNotAllowedError) {
      return res.status(400).json({ message: err.message, code: err.code });
    }
    if (message.includes("not enabled") || message.includes("not configured")) {
      return res.status(503).json({ message });
    }

    const billingCycleResolved = billingCycle ?? "monthly";
    logCheckout400("checkout_session_failed", {
      validation: checkoutClientMessage(err),
      businessId,
      planKey,
      billingCycle: billingCycleResolved,
      includeTrial,
      subscriptionTrialEnabled: isSubscriptionTrialEnabled(),
      configuredPriceId:
        planKey != null ? resolveConfiguredPriceId(planKey, billingCycleResolved) : null,
      errorMessage: message,
      ...stripeErrorDetails(err),
      note: "No server-side guard rejects checkout for existing active/trialing mirror rows; failures here are thrown from Stripe or missing config",
    });

    return res.status(400).json({ message: checkoutClientMessage(err) });
  }
}

function parsePortalFlow(raw: unknown): "default" | "payment_methods" {
  return raw === "payment_methods" ? "payment_methods" : "default";
}

function portalReturnUrl(flow: "default" | "payment_methods"): string {
  const base = (process.env.FRONTEND_URL ?? "http://localhost:5173").replace(/\/$/, "");
  const path =
    flow === "payment_methods"
      ? "/dashboard/billing/payment-methods"
      : "/dashboard/billing/subscription";
  return `${base}${path}`;
}

export async function postMyBillingPortal(req: Request, res: Response) {
  try {
    const ctx = await resolveManagerBusiness(req);
    if (!ctx.ok) {
      return res.status(ctx.status).json({ message: ctx.message });
    }

    // Tenant-scoped status only — never accept client-supplied business/customer IDs.
    const status = await getBillingStatusForBusiness(ctx.businessId);
    if (status.accessSource === "sponsored") {
      return res.status(403).json({
        message: "Billing portal is not available while sponsored access is active",
      });
    }
    if (!status.stripeCustomerId) {
      return res.status(400).json({ message: "No Stripe customer linked to this account" });
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const flow = parsePortalFlow(body.flow);
    const portal = await createManagerPortalSession({
      stripeCustomerId: status.stripeCustomerId,
      flow,
      returnUrl: portalReturnUrl(flow),
    });
    return res.json(portal);
  } catch (err) {
    logServerError("billing.postMyBillingPortal", err);
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("not enabled") || message.includes("not configured")) {
      return res.status(503).json({ message });
    }
    return res.status(400).json({ message: clientSafeMessage(err, CLIENT_FALLBACK.generic) });
  }
}

export async function postMyBillingCancel(req: Request, res: Response) {
  try {
    const ctx = await resolveManagerBusiness(req);
    if (!ctx.ok) {
      return res.status(ctx.status).json({ message: ctx.message });
    }

    const atPeriodEnd = req.body?.atPeriodEnd !== false;
    if (!atPeriodEnd) {
      return res.status(400).json({ message: "Immediate cancellation is not supported. Use atPeriodEnd: true." });
    }

    const result = await scheduleManagerCancelAtPeriodEnd({ businessId: ctx.businessId });
    return res.json({
      status: "scheduled",
      cancelAtPeriodEnd: result.cancelAtPeriodEnd,
      cancellationEffective: result.cancellationEffective,
    });
  } catch (err) {
    logServerError("billing.postMyBillingCancel", err);
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("not enabled") || message.includes("No active Stripe")) {
      return res.status(400).json({ message });
    }
    return res.status(400).json({ message: clientSafeMessage(err, CLIENT_FALLBACK.generic) });
  }
}
