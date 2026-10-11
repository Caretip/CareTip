import { SubscriptionStatus } from "@prisma/client";
import { prisma } from "../prisma.js";
import {
  MIRROR_SUBSCRIPTION_CHECKOUT_BLOCK_STATUSES,
  resolveOwnedEntitledStripeSubscriptionsForBusiness,
  type OwnedStripeSubscriptionListOutcome,
} from "./billingLifecycleIntegrity.service.js";
import { findActiveSponsoredGrantForBusiness } from "./sponsoredAccess.service.js";
import { isSubscriptionMirrorEntitled } from "../lib/subscription/subscriptionMirrorEntitlement.js";
import { isInternalBasicSubscription } from "./subscription.service.js";

export const BILLING_CHECKOUT_BLOCKED_CODE = "ACTIVE_STRIPE_SUBSCRIPTION_EXISTS" as const;
export const BILLING_CHECKOUT_VERIFICATION_UNAVAILABLE_CODE =
  "BILLING_CHECKOUT_VERIFICATION_UNAVAILABLE" as const;

export class BillingCheckoutBlockedError extends Error {
  readonly code = BILLING_CHECKOUT_BLOCKED_CODE;

  constructor(
    message: string,
    readonly useBillingPortal = true,
  ) {
    super(message);
    this.name = "BillingCheckoutBlockedError";
  }
}

/** Stripe subscription state could not be verified — checkout must not start. */
export class BillingCheckoutVerificationError extends Error {
  readonly code = BILLING_CHECKOUT_VERIFICATION_UNAVAILABLE_CODE;
  readonly retryable = true;

  constructor(message = "Subscription billing could not be verified. Please try again shortly.") {
    super(message);
    this.name = "BillingCheckoutVerificationError";
  }
}

export function mirrorBlocksNewCheckout(sub: {
  stripeSubscriptionId: string | null;
  status: SubscriptionStatus;
  planKey: string;
  isTrial: boolean;
  cancelAtPeriodEnd: boolean;
  cancellationEffective: Date | null;
  currentPeriodEnd: Date | null;
  canceledAt: Date | null;
}): boolean {
  if (!sub.stripeSubscriptionId) {
    return false;
  }
  if (isInternalBasicSubscription(sub as Parameters<typeof isInternalBasicSubscription>[0])) {
    return false;
  }
  if (MIRROR_SUBSCRIPTION_CHECKOUT_BLOCK_STATUSES.has(sub.status)) {
    return true;
  }
  return isSubscriptionMirrorEntitled(sub);
}

export function evaluateStripeListOutcomeForCheckout(
  outcome: OwnedStripeSubscriptionListOutcome,
): void {
  if (
    outcome.kind === "verification_failed" ||
    outcome.kind === "skipped_stripe_unavailable"
  ) {
    throw new BillingCheckoutVerificationError();
  }
  if (outcome.kind === "verified" && outcome.subscriptions.length > 0) {
    throw new BillingCheckoutBlockedError(
      "A Stripe subscription is already active for this business. Manage billing in the customer portal.",
    );
  }
}

/**
 * Fail closed before creating a second Stripe subscription checkout session.
 * Advisory xact lock serializes concurrent checkout attempts per business (same DB).
 */
export async function assertSelfServeBillingCheckoutAllowed(businessId: string): Promise<void> {
  const sponsored = await findActiveSponsoredGrantForBusiness(businessId);
  if (sponsored) {
    throw new BillingCheckoutBlockedError(
      "Checkout is not available while sponsored access is active.",
      false,
    );
  }

  let stripeCustomerId: string | null = null;

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`caretip_billing_checkout:${businessId}`}))`;

    const row = await tx.business.findUnique({
      where: { id: businessId },
      select: {
        stripeCustomerId: true,
        subscription: {
          select: {
            planKey: true,
            status: true,
            stripeSubscriptionId: true,
            stripeCustomerId: true,
            isTrial: true,
            cancelAtPeriodEnd: true,
            cancellationEffective: true,
            currentPeriodEnd: true,
            canceledAt: true,
          },
        },
      },
    });

    if (!row) {
      throw new BillingCheckoutBlockedError("Business not found.", false);
    }

    stripeCustomerId = row.stripeCustomerId ?? row.subscription?.stripeCustomerId ?? null;

    const sub = row.subscription;
    if (sub && mirrorBlocksNewCheckout(sub)) {
      throw new BillingCheckoutBlockedError(
        "This business already has an active CareTip subscription. Manage billing in the customer portal.",
      );
    }

    if (
      sub?.stripeSubscriptionId &&
      sub.status &&
      MIRROR_SUBSCRIPTION_CHECKOUT_BLOCK_STATUSES.has(sub.status)
    ) {
      throw new BillingCheckoutBlockedError(
        "This business already has an active CareTip subscription. Manage billing in the customer portal.",
      );
    }
  });

  const stripeOutcome = await resolveOwnedEntitledStripeSubscriptionsForBusiness(
    businessId,
    stripeCustomerId,
  );
  evaluateStripeListOutcomeForCheckout(stripeOutcome);
}
