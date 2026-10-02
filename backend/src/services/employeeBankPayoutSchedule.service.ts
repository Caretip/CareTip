/**
 * Employee Connect standard bank payout cadence (Stripe → bank), not CareTip tip transfers.
 */
import { BusinessBankPayoutSchedule } from "@prisma/client";
import { prisma } from "../prisma.js";
import { logServerError } from "../utils/httpErrors.js";
import { getStripeClient, isStripeConfigured } from "./stripe.service.js";
import { StripeConnectError } from "./stripeConnect.service.js";
import { syncStripeConnectAccountPayoutSchedule } from "./connectBankPayoutSchedule.core.js";
import {
  computeNextEvery3DaysPayoutAt,
  isCareTipControlledBankSchedule,
  parseBusinessBankPayoutSchedule,
} from "./businessBankPayoutSchedule.service.js";
import { resolveActiveEmployeeForConnect } from "./employeeStripeConnect.service.js";

export type EmployeeBankPayoutScheduleDto = {
  schedule: BusinessBankPayoutSchedule;
  nextScheduledPayoutAt: string | null;
  careTipControlled: boolean;
  stripeScheduleInterval: string | null;
};

export async function getEmployeeBankPayoutScheduleForUser(
  userId: string,
): Promise<EmployeeBankPayoutScheduleDto> {
  const actor = await resolveActiveEmployeeForConnect(userId);
  const row = await prisma.employeeStripeAccount.findUnique({
    where: { employeeId: actor.employeeId },
    select: {
      bankPayoutSchedule: true,
      bankPayoutNextScheduledAt: true,
      stripeAccountId: true,
    },
  });
  if (!row) {
    throw new StripeConnectError(
      "Connect a Stripe account before viewing payout schedule.",
      "CONNECT_NOT_LINKED",
      400,
    );
  }

  let stripeScheduleInterval: string | null = null;
  const stripeAccountId = row.stripeAccountId?.trim();
  if (stripeAccountId && isStripeConfigured()) {
    try {
      const acct = await getStripeClient().accounts.retrieve(stripeAccountId);
      stripeScheduleInterval = acct.settings?.payouts?.schedule?.interval ?? null;
    } catch (err) {
      logServerError("employeeBankPayoutSchedule.retrieveAccount", err, {
        employeeId: actor.employeeId,
      });
    }
  }

  return {
    schedule: row.bankPayoutSchedule,
    nextScheduledPayoutAt: row.bankPayoutNextScheduledAt?.toISOString() ?? null,
    careTipControlled: isCareTipControlledBankSchedule(row.bankPayoutSchedule),
    stripeScheduleInterval,
  };
}

export async function setEmployeeBankPayoutScheduleForUser(args: {
  userId: string;
  schedule: BusinessBankPayoutSchedule;
  actorUserId?: string | null;
}): Promise<EmployeeBankPayoutScheduleDto> {
  const actor = await resolveActiveEmployeeForConnect(args.userId);
  const account = await prisma.employeeStripeAccount.findUnique({
    where: { employeeId: actor.employeeId },
    select: {
      employeeId: true,
      stripeAccountId: true,
      stripePayoutsEnabled: true,
      bankPayoutSchedule: true,
      employee: {
        select: {
          business: { select: { timezone: true, employeeTipPayoutMode: true } },
        },
      },
    },
  });
  if (!account?.stripeAccountId?.trim()) {
    throw new StripeConnectError(
      "Connect a Stripe account before changing payout schedule.",
      "CONNECT_NOT_LINKED",
      400,
    );
  }
  if (!account.stripePayoutsEnabled) {
    throw new StripeConnectError(
      "Finish Stripe payout setup before changing payout schedule.",
      "EMPLOYEE_PAYOUTS_NOT_ENABLED",
      400,
    );
  }

  const stripeAccountId = account.stripeAccountId.trim();
  let nextScheduledAt: Date | null = null;
  if (args.schedule === BusinessBankPayoutSchedule.every_3_days) {
    nextScheduledAt = computeNextEvery3DaysPayoutAt({
      timezone: account.employee.business.timezone,
    });
  }

  const previousSchedule = account.bankPayoutSchedule;
  let stripeSync: "ok" | "failed" = "ok";
  try {
    await syncStripeConnectAccountPayoutSchedule(stripeAccountId, args.schedule);
  } catch (err) {
    stripeSync = "failed";
    throw err;
  }

  await prisma.employeeStripeAccount.update({
    where: { employeeId: actor.employeeId },
    data: {
      bankPayoutSchedule: args.schedule,
      bankPayoutNextScheduledAt: nextScheduledAt,
    },
  });

  const { writeAuditLog } = await import("./audit.service.js");
  await writeAuditLog({
    userId: args.actorUserId ?? args.userId,
    action: "employee_bank_payout_schedule_changed",
    metadata: JSON.stringify({
      employeeId: actor.employeeId,
      previousSchedule,
      newSchedule: args.schedule,
      nextScheduledPayoutAt: nextScheduledAt?.toISOString() ?? null,
      timezone: account.employee.business.timezone,
      stripeSync,
    }).slice(0, 4000),
  });

  return getEmployeeBankPayoutScheduleForUser(args.userId);
}

export { parseBusinessBankPayoutSchedule as parseEmployeeBankPayoutSchedule };
