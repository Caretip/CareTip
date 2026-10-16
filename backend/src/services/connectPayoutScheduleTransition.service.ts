/**
 * Guards unsafe payout schedule transitions (no payouts.create).
 */
import { BusinessBankPayoutSchedule } from "@prisma/client";
import { prisma } from "../prisma.js";
import { StripeConnectError } from "./stripeConnect.service.js";
import { isCareTipControlledBankSchedule } from "./businessBankPayoutSchedule.service.js";

const PENDING_LEDGER_STATUSES = ["pending", "submitted"] as const;

export async function assertBusinessScheduleTransitionSafe(args: {
  businessId: string;
  previousSchedule: BusinessBankPayoutSchedule;
  nextSchedule: BusinessBankPayoutSchedule;
}): Promise<void> {
  const leavingCareTipScheduler =
    isCareTipControlledBankSchedule(args.previousSchedule) &&
    !isCareTipControlledBankSchedule(args.nextSchedule);
  const enteringCareTipScheduler =
    !isCareTipControlledBankSchedule(args.previousSchedule) &&
    isCareTipControlledBankSchedule(args.nextSchedule);
  if (!leavingCareTipScheduler && !enteringCareTipScheduler) return;

  const pending = await prisma.stripeConnectScheduledPayoutRequest.count({
    where: {
      businessId: args.businessId,
      status: { in: [...PENDING_LEDGER_STATUSES] },
    },
  });
  if (pending > 0) {
    throw new StripeConnectError(
      "A scheduled payout is still in progress. Try again after it completes.",
      "BANK_PAYOUT_SCHEDULE_TRANSITION_BLOCKED",
      409,
    );
  }
}

export async function assertEmployeeScheduleTransitionSafe(args: {
  employeeId: string;
  previousSchedule: BusinessBankPayoutSchedule;
  nextSchedule: BusinessBankPayoutSchedule;
}): Promise<void> {
  const leavingCareTipScheduler =
    isCareTipControlledBankSchedule(args.previousSchedule) &&
    !isCareTipControlledBankSchedule(args.nextSchedule);
  const enteringCareTipScheduler =
    !isCareTipControlledBankSchedule(args.previousSchedule) &&
    isCareTipControlledBankSchedule(args.nextSchedule);
  if (!leavingCareTipScheduler && !enteringCareTipScheduler) return;

  const pending = await prisma.employeeStripeScheduledPayoutRequest.count({
    where: {
      employeeId: args.employeeId,
      status: { in: [...PENDING_LEDGER_STATUSES] },
    },
  });
  if (pending > 0) {
    throw new StripeConnectError(
      "A scheduled payout is still in progress. Try again after it completes.",
      "BANK_PAYOUT_SCHEDULE_TRANSITION_BLOCKED",
      409,
    );
  }
}

export async function businessHasPendingScheduledPayoutLedger(businessId: string): Promise<boolean> {
  const n = await prisma.stripeConnectScheduledPayoutRequest.count({
    where: { businessId, status: { in: [...PENDING_LEDGER_STATUSES] } },
  });
  return n > 0;
}

export async function employeeHasPendingScheduledPayoutLedger(employeeId: string): Promise<boolean> {
  const n = await prisma.employeeStripeScheduledPayoutRequest.count({
    where: { employeeId, status: { in: [...PENDING_LEDGER_STATUSES] } },
  });
  return n > 0;
}
