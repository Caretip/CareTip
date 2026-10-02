/**
 * Per-business bank payout cadence (Connect standard payouts).
 *
 * Stripe-native: daily | weekly | monthly → accounts.update settings.payouts.schedule
 * CareTip-controlled: every_3_days → Stripe interval manual + CareTip scheduler (every_3_days only).
 * DB enum `manual` is legacy-only (not user-selectable); Stripe `interval: manual` is also used for every_3_days.
 *
 * Stripe does not support interval "every 3 days" — see Stripe Connect payout schedule docs.
 */
import { BusinessBankPayoutSchedule } from "@prisma/client";
import { DateTime } from "luxon";
import { prisma } from "../prisma.js";
import { sanitizeIanaTimezone } from "../utils/businessTime.js";
import { logServerError } from "../utils/httpErrors.js";
import { getStripeClient, isStripeConfigured } from "./stripe.service.js";
import { StripeConnectError } from "./stripeConnect.service.js";
import {
  __setUpdateConnectAccountPayoutScheduleFnForTests,
  syncStripeConnectAccountPayoutSchedule,
  type StripePayoutScheduleUpdate,
} from "./connectBankPayoutSchedule.core.js";

/** All persisted enum values (includes legacy `manual`). */
export const BUSINESS_BANK_PAYOUT_SCHEDULE_VALUES: readonly BusinessBankPayoutSchedule[] = [
  BusinessBankPayoutSchedule.daily,
  BusinessBankPayoutSchedule.every_3_days,
  BusinessBankPayoutSchedule.weekly,
  BusinessBankPayoutSchedule.monthly,
  BusinessBankPayoutSchedule.manual,
];

/** Schedules end users may choose in product UI / PATCH APIs. */
export const USER_SELECTABLE_BUSINESS_BANK_PAYOUT_SCHEDULE_VALUES: readonly BusinessBankPayoutSchedule[] =
  [
    BusinessBankPayoutSchedule.daily,
    BusinessBankPayoutSchedule.every_3_days,
    BusinessBankPayoutSchedule.weekly,
    BusinessBankPayoutSchedule.monthly,
  ];

export type BusinessBankPayoutScheduleDto = {
  schedule: BusinessBankPayoutSchedule;
  nextScheduledPayoutAt: string | null;
  careTipControlled: boolean;
  stripeScheduleInterval: string | null;
};

export function __setUpdateAccountScheduleFnForTests(
  fn: ((stripeAccountId: string, schedule: StripePayoutScheduleUpdate) => Promise<void>) | null,
): void {
  __setUpdateConnectAccountPayoutScheduleFnForTests(fn);
}

export function parseBusinessBankPayoutSchedule(raw: unknown): BusinessBankPayoutSchedule {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (v === BusinessBankPayoutSchedule.manual) {
    throw new StripeConnectError(
      "Manual payout schedule is not available.",
      "BANK_PAYOUT_SCHEDULE_NOT_AVAILABLE",
      400,
    );
  }
  if ((USER_SELECTABLE_BUSINESS_BANK_PAYOUT_SCHEDULE_VALUES as readonly string[]).includes(v)) {
    return v as BusinessBankPayoutSchedule;
  }
  throw new StripeConnectError("Invalid payout schedule.", "BANK_PAYOUT_SCHEDULE_INVALID", 400);
}

export function isCareTipControlledBankSchedule(schedule: BusinessBankPayoutSchedule): boolean {
  return schedule === BusinessBankPayoutSchedule.every_3_days;
}

/**
 * Every 3 **calendar** days at 09:00 in the business IANA timezone.
 * First selection: first due date is three calendar days from activation at 09:00 local.
 */
export function computeNextEvery3DaysPayoutAt(args: {
  timezone: string;
  previousAnchorUtc?: Date | null;
}): Date {
  const tz = sanitizeIanaTimezone(args.timezone);
  const base =
    args.previousAnchorUtc != null
      ? DateTime.fromJSDate(args.previousAnchorUtc, { zone: "utc" }).setZone(tz)
      : DateTime.now().setZone(tz);
  return base
    .plus({ days: 3 })
    .set({ hour: 9, minute: 0, second: 0, millisecond: 0 })
    .toUTC()
    .toJSDate();
}

export function scheduleWindowKeyFromDate(d: Date): string {
  return d.toISOString();
}

async function syncStripePayoutSchedule(
  stripeAccountId: string,
  schedule: BusinessBankPayoutSchedule,
): Promise<void> {
  await syncStripeConnectAccountPayoutSchedule(stripeAccountId, schedule);
}

export async function getBusinessBankPayoutScheduleForBusiness(
  businessId: string,
): Promise<BusinessBankPayoutScheduleDto> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      bankPayoutSchedule: true,
      bankPayoutNextScheduledAt: true,
      stripeAccountId: true,
    },
  });
  if (!business) {
    throw new StripeConnectError("Business not found.", "BUSINESS_NOT_FOUND", 404);
  }

  let stripeScheduleInterval: string | null = null;
  if (business.stripeAccountId?.trim() && isStripeConfigured()) {
    try {
      const acct = await getStripeClient().accounts.retrieve(business.stripeAccountId);
      stripeScheduleInterval = acct.settings?.payouts?.schedule?.interval ?? null;
    } catch (err) {
      logServerError("businessBankPayoutSchedule.retrieveAccount", err, { businessId });
    }
  }

  return {
    schedule: business.bankPayoutSchedule,
    nextScheduledPayoutAt: business.bankPayoutNextScheduledAt?.toISOString() ?? null,
    careTipControlled: isCareTipControlledBankSchedule(business.bankPayoutSchedule),
    stripeScheduleInterval,
  };
}

export async function setBusinessBankPayoutScheduleForBusiness(args: {
  businessId: string;
  schedule: BusinessBankPayoutSchedule;
  actorUserId?: string | null;
}): Promise<BusinessBankPayoutScheduleDto> {
  const business = await prisma.business.findUnique({
    where: { id: args.businessId },
    select: {
      id: true,
      deletedAt: true,
      legalHold: true,
      stripeAccountId: true,
      stripePayoutsEnabled: true,
      timezone: true,
      bankPayoutSchedule: true,
      bankPayoutNextScheduledAt: true,
    },
  });
  if (!business) {
    throw new StripeConnectError("Business not found.", "BUSINESS_NOT_FOUND", 404);
  }
  if (business.deletedAt) {
    throw new StripeConnectError("Business is closed.", "BUSINESS_SOFT_CLOSED", 403);
  }
  if (business.legalHold) {
    throw new StripeConnectError("Payout settings are blocked during legal hold.", "BUSINESS_LEGAL_HOLD", 403);
  }

  const stripeAccountId = business.stripeAccountId?.trim();
  if (!stripeAccountId) {
    throw new StripeConnectError(
      "Connect a Stripe account before changing payout schedule.",
      "CONNECT_NOT_LINKED",
      400,
    );
  }

  let nextScheduledAt: Date | null = null;
  if (args.schedule === BusinessBankPayoutSchedule.every_3_days) {
    nextScheduledAt = computeNextEvery3DaysPayoutAt({ timezone: business.timezone });
  }

  const previousSchedule = business.bankPayoutSchedule;
  let stripeSync: "ok" | "failed" = "ok";
  try {
    await syncStripePayoutSchedule(stripeAccountId, args.schedule);
  } catch (err) {
    stripeSync = "failed";
    throw err;
  }

  await prisma.business.update({
    where: { id: args.businessId },
    data: {
      bankPayoutSchedule: args.schedule,
      bankPayoutNextScheduledAt: nextScheduledAt,
    },
  });

  const { writeAuditLog } = await import("./audit.service.js");
  await writeAuditLog({
    userId: args.actorUserId ?? null,
    action: "business_bank_payout_schedule_changed",
    metadata: JSON.stringify({
      businessId: args.businessId,
      previousSchedule,
      newSchedule: args.schedule,
      nextScheduledPayoutAt: nextScheduledAt?.toISOString() ?? null,
      timezone: business.timezone,
      stripeSync,
    }).slice(0, 4000),
  });

  return getBusinessBankPayoutScheduleForBusiness(args.businessId);
}
