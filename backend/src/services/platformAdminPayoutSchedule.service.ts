/**
 * Read-only payout schedule context for Platform Admin (business + employees).
 */
import { BusinessBankPayoutSchedule, StripeConnectPayoutStatus } from "@prisma/client";
import { prisma } from "../prisma.js";
import {
  getBusinessBankPayoutScheduleForBusiness,
  isCareTipControlledBankSchedule,
} from "./businessBankPayoutSchedule.service.js";
import { getStripeClient, isStripeConfigured } from "./stripe.service.js";
import { logServerError } from "../utils/httpErrors.js";

export type PlatformAdminPayoutScheduleRow = {
  subjectKind: "business" | "employee";
  subjectId: string;
  subjectName: string;
  stripeAccountId: string | null;
  careTipSchedule: BusinessBankPayoutSchedule;
  stripeScheduleInterval: string | null;
  careTipControlled: boolean;
  executionLabel: "stripe_automatic" | "caretip_scheduled" | "manual_no_caretip_run";
  nextScheduledPayoutAt: string | null;
  timezone: string;
  lastPayoutCreatedAt: string | null;
  lastPayoutStatus: StripeConnectPayoutStatus | null;
  lastPayoutAmountCents: number | null;
};

export type PlatformAdminBusinessPayoutScheduleContext = {
  businessId: string;
  businessName: string;
  timezone: string;
  business: PlatformAdminPayoutScheduleRow;
  employees: PlatformAdminPayoutScheduleRow[];
};

function executionLabel(
  schedule: BusinessBankPayoutSchedule,
  careTipControlled: boolean,
): PlatformAdminPayoutScheduleRow["executionLabel"] {
  if (schedule === BusinessBankPayoutSchedule.manual) return "manual_no_caretip_run";
  if (schedule === BusinessBankPayoutSchedule.every_3_days && careTipControlled) {
    return "caretip_scheduled";
  }
  return "stripe_automatic";
}

async function lastBusinessPayout(businessId: string) {
  return prisma.stripeConnectPayout.findFirst({
    where: { businessId },
    orderBy: { stripeCreatedAt: "desc" },
    select: {
      stripeCreatedAt: true,
      status: true,
      amountCents: true,
    },
  });
}

async function lastEmployeePayout(employeeId: string) {
  return prisma.employeeStripePayout.findFirst({
    where: { employeeId },
    orderBy: { stripeCreatedAt: "desc" },
    select: {
      stripeCreatedAt: true,
      status: true,
      amountCents: true,
    },
  });
}

export async function getPlatformAdminBusinessPayoutScheduleContext(
  businessId: string,
): Promise<PlatformAdminBusinessPayoutScheduleContext | null> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true,
      name: true,
      timezone: true,
      deletedAt: true,
      stripeAccountId: true,
      employees: {
        where: { isDeleted: false },
        select: {
          id: true,
          name: true,
        },
        orderBy: { name: "asc" },
        take: 200,
      },
    },
  });
  if (!business || business.deletedAt) return null;

  const businessSchedule = await getBusinessBankPayoutScheduleForBusiness(businessId);
  const businessLast = await lastBusinessPayout(businessId);

  const businessRow: PlatformAdminPayoutScheduleRow = {
    subjectKind: "business",
    subjectId: business.id,
    subjectName: business.name,
    stripeAccountId: business.stripeAccountId?.trim() || null,
    careTipSchedule: businessSchedule.schedule,
    stripeScheduleInterval: businessSchedule.stripeScheduleInterval,
    careTipControlled: businessSchedule.careTipControlled,
    executionLabel: executionLabel(businessSchedule.schedule, businessSchedule.careTipControlled),
    nextScheduledPayoutAt: businessSchedule.nextScheduledPayoutAt,
    timezone: business.timezone,
    lastPayoutCreatedAt: businessLast?.stripeCreatedAt.toISOString() ?? null,
    lastPayoutStatus: businessLast?.status ?? null,
    lastPayoutAmountCents: businessLast?.amountCents ?? null,
  };

  const employeeAccounts = await prisma.employeeStripeAccount.findMany({
    where: { employeeId: { in: business.employees.map((e) => e.id) } },
    select: {
      employeeId: true,
      stripeAccountId: true,
      bankPayoutSchedule: true,
      bankPayoutNextScheduledAt: true,
    },
  });
  const accountByEmployee = new Map(employeeAccounts.map((a) => [a.employeeId, a]));

  const employees: PlatformAdminPayoutScheduleRow[] = [];
  for (const emp of business.employees) {
    const acct = accountByEmployee.get(emp.id);
    if (!acct?.stripeAccountId?.trim()) {
      employees.push({
        subjectKind: "employee",
        subjectId: emp.id,
        subjectName: emp.name,
        stripeAccountId: null,
        careTipSchedule: BusinessBankPayoutSchedule.manual,
        stripeScheduleInterval: null,
        careTipControlled: false,
        executionLabel: "manual_no_caretip_run",
        nextScheduledPayoutAt: null,
        timezone: business.timezone,
        lastPayoutCreatedAt: null,
        lastPayoutStatus: null,
        lastPayoutAmountCents: null,
      });
      continue;
    }
    const schedule = acct.bankPayoutSchedule;
    const careTipControlled = isCareTipControlledBankSchedule(schedule);
    let stripeScheduleInterval: string | null = null;
    const stripeAccountId = acct.stripeAccountId.trim();
    if (isStripeConfigured()) {
      try {
        const stripeAcct = await getStripeClient().accounts.retrieve(stripeAccountId);
        stripeScheduleInterval = stripeAcct.settings?.payouts?.schedule?.interval ?? null;
      } catch (err) {
        logServerError("platformAdminPayoutSchedule.employeeStripeAccount", err, {
          employeeId: emp.id,
        });
      }
    }
    const last = await lastEmployeePayout(emp.id);
    employees.push({
      subjectKind: "employee",
      subjectId: emp.id,
      subjectName: emp.name,
      stripeAccountId,
      careTipSchedule: schedule,
      stripeScheduleInterval,
      careTipControlled,
      executionLabel: executionLabel(schedule, careTipControlled),
      nextScheduledPayoutAt: acct.bankPayoutNextScheduledAt?.toISOString() ?? null,
      timezone: business.timezone,
      lastPayoutCreatedAt: last?.stripeCreatedAt.toISOString() ?? null,
      lastPayoutStatus: last?.status ?? null,
      lastPayoutAmountCents: last?.amountCents ?? null,
    });
  }

  return {
    businessId: business.id,
    businessName: business.name,
    timezone: business.timezone,
    business: businessRow,
    employees,
  };
}
