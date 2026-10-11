import {
  type BusinessSubscriptionTier,
  type SubscriptionPlanKey,
  SubscriptionStatus,
} from "@prisma/client";
import { mapBusinessTierToPlanKey } from "./mapSubscriptionPlanKey.js";

export type AdminBillingLinkageSnapshot = {
  stripeSubscriptionId: string | null;
  status: SubscriptionStatus | null;
  planKey: SubscriptionPlanKey | null;
};

export const ADMIN_SUBSCRIPTION_STRIPE_CONFLICT_CODE = "ADMIN_SUBSCRIPTION_STRIPE_CONFLICT" as const;

export class AdminSubscriptionStripeConflictError extends Error {
  readonly code = ADMIN_SUBSCRIPTION_STRIPE_CONFLICT_CODE;

  constructor(message: string) {
    super(message);
    this.name = "AdminSubscriptionStripeConflictError";
  }
}

/**
 * Mirror statuses that still represent an in-flight or billable Stripe subscription link.
 * Complimentary/admin tier edits must not overwrite these without changing Stripe first.
 *
 * Limitation: policy uses the CareTip mirror only; a stale stripeSubscriptionId with status
 * `canceled` may still exist in Stripe until reconciled — operators should verify Stripe.
 */
const MIRROR_STATUS_BLOCKS_ADMIN_PLAN_OVERRIDE = new Set<SubscriptionStatus>([
  SubscriptionStatus.active,
  SubscriptionStatus.trialing,
  SubscriptionStatus.past_due,
  SubscriptionStatus.incomplete,
  SubscriptionStatus.unpaid,
]);

export type AdminTierChangeEvaluation =
  | { allowed: true; reason: "no_stripe_link" | "ended_stripe_link" | "same_plan_tier" }
  | {
      allowed: false;
      reason:
        | "stripe_billed_mirror_active"
        | "stripe_link_unknown_status"
        | "stripe_subscription_id_without_status";
    };

export function evaluateAdminSubscriptionTierChange(
  snapshot: AdminBillingLinkageSnapshot | null,
  newTier: BusinessSubscriptionTier,
): AdminTierChangeEvaluation {
  if (!snapshot?.stripeSubscriptionId) {
    return { allowed: true, reason: "no_stripe_link" };
  }

  const status = snapshot.status;
  if (status == null) {
    return { allowed: false, reason: "stripe_subscription_id_without_status" };
  }

  if (status === SubscriptionStatus.canceled) {
    const newPlanKey = mapBusinessTierToPlanKey(newTier);
    const currentPlanKey = snapshot.planKey;
    if (currentPlanKey && newPlanKey === currentPlanKey) {
      return { allowed: true, reason: "same_plan_tier" };
    }
    return { allowed: true, reason: "ended_stripe_link" };
  }

  if (!MIRROR_STATUS_BLOCKS_ADMIN_PLAN_OVERRIDE.has(status)) {
    return { allowed: false, reason: "stripe_link_unknown_status" };
  }

  const newPlanKey = mapBusinessTierToPlanKey(newTier);
  const currentPlanKey = snapshot.planKey;
  if (currentPlanKey && newPlanKey === currentPlanKey) {
    return { allowed: true, reason: "same_plan_tier" };
  }

  return { allowed: false, reason: "stripe_billed_mirror_active" };
}

export function assertAdminSubscriptionTierChangeAllowed(
  snapshot: AdminBillingLinkageSnapshot | null,
  newTier: BusinessSubscriptionTier,
): void {
  const evaluation = evaluateAdminSubscriptionTierChange(snapshot, newTier);
  if (evaluation.allowed) {
    return;
  }

  if (evaluation.reason === "stripe_subscription_id_without_status") {
    throw new AdminSubscriptionStripeConflictError(
      "This business has a Stripe subscription ID on file but the mirror status is missing. Reconcile billing before changing the plan in admin.",
    );
  }

  if (evaluation.reason === "stripe_link_unknown_status") {
    throw new AdminSubscriptionStripeConflictError(
      "This business has a Stripe subscription link in an unrecognized state. Reconcile billing before changing the plan in admin.",
    );
  }

  throw new AdminSubscriptionStripeConflictError(
    "This business has an active Stripe-billed subscription. Change the plan in Stripe or cancel billing before applying a complimentary tier change in the admin console.",
  );
}
