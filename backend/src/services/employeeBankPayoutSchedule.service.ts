/**
 * Employee Connect standard bank payout cadence (Stripe → bank), not CareTip tip transfers.
 */
import { BusinessBankPayoutSchedule } from "@prisma/client";
import { prisma } from "../prisma.js";
import { logServerError } from "../utils/httpErrors.js";
import { isStripeConfigured } from "./stripe.service.js";
import { StripeConnectError } from "./stripeConnect.service.js";
import {
  computeNextEvery3DaysPayoutAt,
  isCareTipControlledBankSchedule,
  parseBusinessBankPayoutSchedule,
  type BusinessBankPayoutScheduleDto,
} from "./businessBankPayoutSchedule.service.js";
import type { ConnectPayoutPolicyApplyDto, SettlementDelayReadDto } from "./connectPayoutPolicy.types.js";
import { settlementReadUnavailable } from "./connectSettlementRead.service.js";
import { assertEmployeeScheduleTransitionSafe } from "./connectPayoutScheduleTransition.service.js";
import { resolveActiveEmployeeForConnect } from "./employeeStripeConnect.service.js";

export type EmployeeBankPayoutScheduleDto = BusinessBankPayoutScheduleDto;

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
  let scheduleDrift = false;
  let settlement: SettlementDelayReadDto = settlementReadUnavailable();
  const stripeAccountId = row.stripeAccountId?.trim();
  if (stripeAccountId && isStripeConfigured()) {
    try {
      const { readConnectPayoutConfigurationStatus } = await import(
        "./connectPayoutConfiguration.service.js"
      );
      const status = await readConnectPayoutConfigurationStatus(
        stripeAccountId,
        row.bankPayoutSchedule,
      );
      stripeScheduleInterval = status.stripeScheduleInterval;
      scheduleDrift = status.scheduleDrift;
      settlement = status.settlement;
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
    scheduleDrift,
    settlement,
    lastPolicyApply: null,
    effectiveSettlementDelayDays: settlement.effectiveDelayDays,
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
  await assertEmployeeScheduleTransitionSafe({
    employeeId: actor.employeeId,
    previousSchedule,
    nextSchedule: args.schedule,
  });

  let policyApply: ConnectPayoutPolicyApplyDto | null = null;
  let stripeSync: "ok" | "failed" = "ok";
  try {
    const { applyConnectPayoutPolicy } = await import("./connectPayoutConfiguration.service.js");
    policyApply = await applyConnectPayoutPolicy({
      stripeAccountId,
      careTipSchedule: args.schedule,
      context: "schedule_change",
    });
    const scheduleOk =
      policyApply.schedule.status === "schedule_synced" ||
      policyApply.schedule.status === "schedule_unchanged";
    if (!scheduleOk) {
      throw new StripeConnectError(
        "Could not update Stripe payout schedule.",
        "STRIPE_PAYOUT_SCHEDULE_SYNC_FAILED",
        502,
      );
    }
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

  const dto = await getEmployeeBankPayoutScheduleForUser(args.userId);
  return { ...dto, lastPolicyApply: policyApply };
}

export { parseBusinessBankPayoutSchedule as parseEmployeeBankPayoutSchedule };
