import { SubscriptionStatus } from "@prisma/client";

/** Whether a Subscription mirror row grants product entitlements (trialing, active, past_due, or cancel grace). */
export function isSubscriptionMirrorEntitled(sub: {
  status: SubscriptionStatus;
  cancelAtPeriodEnd: boolean;
  cancellationEffective: Date | null;
  currentPeriodEnd: Date | null;
  canceledAt: Date | null;
}): boolean {
  const now = new Date();

  if (sub.status === SubscriptionStatus.paused) {
    return false;
  }

  if (
    sub.status === SubscriptionStatus.trialing ||
    sub.status === SubscriptionStatus.active ||
    sub.status === SubscriptionStatus.past_due
  ) {
    if (sub.cancelAtPeriodEnd) {
      const effective = sub.cancellationEffective ?? sub.currentPeriodEnd;
      if (effective && effective <= now) return false;
    }
    return true;
  }

  if (sub.status === SubscriptionStatus.canceled) {
    const effective = sub.cancellationEffective ?? sub.currentPeriodEnd ?? sub.canceledAt;
    if (effective && effective > now) return true;
    return false;
  }

  return false;
}
