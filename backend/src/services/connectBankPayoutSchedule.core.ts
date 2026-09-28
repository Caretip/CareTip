/**
 * Shared Stripe Connect standard bank payout schedule sync (business + employee accounts).
 */
import { BusinessBankPayoutSchedule } from "@prisma/client";
import type Stripe from "stripe";
import { getStripeClient, isStripeConfigured } from "./stripe.service.js";

export type StripePayoutScheduleUpdate = Stripe.AccountUpdateParams.Settings.Payouts.Schedule;

let updateAccountScheduleFn:
  | ((stripeAccountId: string, schedule: StripePayoutScheduleUpdate) => Promise<void>)
  | null = null;

export function __setUpdateConnectAccountPayoutScheduleFnForTests(
  fn: ((stripeAccountId: string, schedule: StripePayoutScheduleUpdate) => Promise<void>) | null,
): void {
  updateAccountScheduleFn = fn;
}

export function stripePayoutScheduleUpdateForPreference(
  schedule: BusinessBankPayoutSchedule,
): StripePayoutScheduleUpdate {
  if (schedule === BusinessBankPayoutSchedule.daily) {
    return { interval: "daily" };
  }
  if (schedule === BusinessBankPayoutSchedule.weekly) {
    return { interval: "weekly", weekly_anchor: "monday" };
  }
  if (schedule === BusinessBankPayoutSchedule.monthly) {
    return { interval: "monthly", monthly_anchor: 1 };
  }
  return { interval: "manual" };
}

export async function syncStripeConnectAccountPayoutSchedule(
  stripeAccountId: string,
  schedule: BusinessBankPayoutSchedule,
): Promise<void> {
  if (!isStripeConfigured() && !updateAccountScheduleFn) return;

  const stripeSchedule = stripePayoutScheduleUpdateForPreference(schedule);

  if (updateAccountScheduleFn) {
    await updateAccountScheduleFn(stripeAccountId, stripeSchedule);
    return;
  }

  await getStripeClient().accounts.update(stripeAccountId, {
    settings: { payouts: { schedule: stripeSchedule } },
  });
}
