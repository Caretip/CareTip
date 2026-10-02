import type { BusinessBankPayoutSchedule } from "./api";

/** User-selectable bank payout cadences (excludes legacy application `manual`). */
export const USER_SELECTABLE_BANK_PAYOUT_SCHEDULES: readonly BusinessBankPayoutSchedule[] = [
  "daily",
  "every_3_days",
  "weekly",
  "monthly",
];

export type UserSelectableBankPayoutSchedule =
  (typeof USER_SELECTABLE_BANK_PAYOUT_SCHEDULES)[number];

export function isUserSelectableBankPayoutSchedule(
  schedule: string,
): schedule is UserSelectableBankPayoutSchedule {
  return (USER_SELECTABLE_BANK_PAYOUT_SCHEDULES as readonly string[]).includes(schedule);
}
