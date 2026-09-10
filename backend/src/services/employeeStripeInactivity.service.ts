/**
 * CareTip 45-day employee inactivity (Fanny Phase 32).
 *
 * Never calls Stripe reject/disconnect and never toggles payouts_enabled.
 * Pauses QR receiving in CareTip only. Stripe Express stays connected.
 */
import { EmployeeActivationStatus } from "@prisma/client";
import {
  EMPLOYEE_RECEIVING_PAUSED_NO_ELIGIBLE_TIP,
  EMPLOYEE_STRIPE_INACTIVITY_DAYS,
  EMPLOYEE_STRIPE_INACTIVITY_WARNING_DAYS,
} from "../config/employeeStripeInactivity.js";
import { prisma } from "../prisma.js";
import { StripeConnectError } from "./stripeConnect.service.js";
import { NotificationType } from "./push/notification.types.js";
import { deliverUserNotification } from "./notifications/notificationOrchestrator.service.js";

export type EmployeeInactivityOutcome =
  | "active"
  | "warned"
  | "paused"
  | "skipped_not_receivable";

export type EmployeeInactivityEvaluation = {
  employeeId: string;
  daysSinceLastEligibleTip: number;
  lastEligibleTipAt: string | null;
  outcome: EmployeeInactivityOutcome;
  receivingPaused: boolean;
};

type NotifyFn = (args: {
  kind: "warning" | "admin";
  employeeId: string;
  employeeUserId: string | null;
  managerUserId: string | null;
  employeeName: string;
}) => Promise<void>;

let notifyFn: NotifyFn | null = null;

export function __setEmployeeInactivityNotifyFnForTests(fn: NotifyFn | null): void {
  notifyFn = fn;
}

export function __resetEmployeeInactivityNotifyFnForTests(): void {
  notifyFn = null;
}

const MS_DAY = 86_400_000;

function daysBetween(later: Date, earlier: Date): number {
  return Math.floor((later.getTime() - earlier.getTime()) / MS_DAY);
}

function maxDate(dates: Array<Date | null | undefined>): Date {
  let best = dates[0] ?? new Date(0);
  for (const d of dates) {
    if (d && d.getTime() > best.getTime()) best = d;
  }
  return best;
}

export function isCareTipReceivingPaused(row: { receivingPausedAt: Date | null }): boolean {
  return row.receivingPausedAt != null;
}

async function defaultNotify(args: {
  kind: "warning" | "admin";
  employeeId: string;
  employeeUserId: string | null;
  managerUserId: string | null;
  employeeName: string;
}): Promise<void> {
  if (args.kind === "warning") {
    if (!args.employeeUserId) return;
    await deliverUserNotification({
      userId: args.employeeUserId,
      payload: {
        type: NotificationType.SYSTEM_ALERT,
        title: "Your profile will be set to inactive in 10 days due to inactivity",
        body: "Your profile will be set to inactive in 10 days due to inactivity",
        localeTemplate: { id: "employee_inactivity_warning" },
        url: "/employee/dashboard",
        metadata: { employeeId: args.employeeId },
      },
      channels: { in_app: true, push: true, email: true },
      dedupeKey: `employee-inactivity-warning:${args.employeeId}`,
    });
    return;
  }
  if (!args.managerUserId) return;
  await deliverUserNotification({
    userId: args.managerUserId,
    payload: {
      type: NotificationType.SYSTEM_ALERT,
      title: "A team member was set inactive due to inactivity",
      body: `${args.employeeName} was set inactive because they had no eligible tips for 45 days. Their Stripe account was not disconnected.`,
      localeTemplate: {
        id: "employee_inactivity_admin",
        params: { employeeName: args.employeeName },
      },
      url: "/dashboard/team/employees",
      metadata: { employeeId: args.employeeId },
    },
    channels: { in_app: true, push: false, email: true },
    dedupeKey: `employee-inactivity-admin:${args.employeeId}`,
  });
}

async function notify(args: Parameters<NotifyFn>[0]): Promise<void> {
  const fn = notifyFn ?? defaultNotify;
  await fn(args);
}

export async function evaluateEmployeeStripeInactivityForEmployee(args: {
  employeeId: string;
  now?: Date;
}): Promise<EmployeeInactivityEvaluation | null> {
  const now = args.now ?? new Date();
  const employee = await prisma.employee.findUnique({
    where: { id: args.employeeId },
    select: {
      id: true,
      name: true,
      isDeleted: true,
      isActive: true,
      activationStatus: true,
      createdAt: true,
      receivingPausedAt: true,
      receivingResumedAt: true,
      inactivityWarningSentAt: true,
      inactivityAdminNotifiedAt: true,
      userId: true,
      business: { select: { userId: true } },
    },
  });
  if (!employee || employee.isDeleted) return null;

  const lastPayable = await prisma.employeeTipPayable.findFirst({
    where: { employeeId: args.employeeId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const lastEligibleTipAt = lastPayable?.createdAt
    ? maxDate([lastPayable.createdAt, employee.receivingResumedAt])
    : (employee.receivingResumedAt ?? employee.createdAt);
  const daysSinceLastEligibleTip = daysBetween(now, lastEligibleTipAt);

  const receivable =
    employee.isActive &&
    employee.activationStatus === EmployeeActivationStatus.active &&
    !employee.isDeleted;

  let outcome: EmployeeInactivityOutcome = "active";
  if (!receivable && !employee.receivingPausedAt) {
    outcome = "skipped_not_receivable";
  } else if (employee.receivingPausedAt) {
    outcome = "paused";
  } else if (daysSinceLastEligibleTip >= EMPLOYEE_STRIPE_INACTIVITY_DAYS) {
    outcome = "paused";
  } else if (daysSinceLastEligibleTip >= EMPLOYEE_STRIPE_INACTIVITY_WARNING_DAYS) {
    outcome = "warned";
  }

  console.info(
    JSON.stringify({
      event: "employee_caretip_inactivity_evaluated",
      employeeId: args.employeeId,
      daysSinceLastEligibleTip,
      outcome,
      receivingPaused: Boolean(employee.receivingPausedAt),
    }),
  );

  return {
    employeeId: args.employeeId,
    daysSinceLastEligibleTip,
    lastEligibleTipAt: lastEligibleTipAt.toISOString(),
    outcome,
    receivingPaused: Boolean(employee.receivingPausedAt),
  };
}

export async function processEmployeeCareTipInactivity(args: {
  employeeId: string;
  now: Date;
}): Promise<{
  outcome: EmployeeInactivityOutcome;
  warningSent: boolean;
  pausedNow: boolean;
  adminEmailed: boolean;
}> {
  const evaluation = await evaluateEmployeeStripeInactivityForEmployee({
    employeeId: args.employeeId,
    now: args.now,
  });
  if (!evaluation) {
    return { outcome: "skipped_not_receivable", warningSent: false, pausedNow: false, adminEmailed: false };
  }

  const employee = await prisma.employee.findUnique({
    where: { id: args.employeeId },
    select: {
      name: true,
      userId: true,
      isActive: true,
      isDeleted: true,
      activationStatus: true,
      receivingPausedAt: true,
      inactivityWarningSentAt: true,
      inactivityAdminNotifiedAt: true,
      business: { select: { userId: true } },
    },
  });
  if (!employee || employee.isDeleted) {
    return { outcome: "skipped_not_receivable", warningSent: false, pausedNow: false, adminEmailed: false };
  }

  let warningSent = false;
  let pausedNow = false;
  let adminEmailed = false;

  if (
    evaluation.outcome === "warned" &&
    !employee.inactivityWarningSentAt &&
    employee.isActive &&
    employee.activationStatus === EmployeeActivationStatus.active
  ) {
    await prisma.employee.update({
      where: { id: args.employeeId },
      data: { inactivityWarningSentAt: args.now },
    });
    await notify({
      kind: "warning",
      employeeId: args.employeeId,
      employeeUserId: employee.userId,
      managerUserId: employee.business.userId,
      employeeName: employee.name,
    });
    warningSent = true;
  }

  if (
    evaluation.outcome === "paused" &&
    !employee.receivingPausedAt &&
    employee.isActive &&
    employee.activationStatus === EmployeeActivationStatus.active
  ) {
    await prisma.employee.update({
      where: { id: args.employeeId },
      data: {
        receivingPausedAt: args.now,
        receivingPausedReason: EMPLOYEE_RECEIVING_PAUSED_NO_ELIGIBLE_TIP,
      },
    });
    pausedNow = true;
    console.info(
      JSON.stringify({
        event: "employee_caretip_receiving_paused",
        employeeId: args.employeeId,
        reason: EMPLOYEE_RECEIVING_PAUSED_NO_ELIGIBLE_TIP,
        stripeDisconnected: false,
      }),
    );
    if (!employee.inactivityAdminNotifiedAt) {
      await prisma.employee.update({
        where: { id: args.employeeId },
        data: { inactivityAdminNotifiedAt: args.now },
      });
      await notify({
        kind: "admin",
        employeeId: args.employeeId,
        employeeUserId: employee.userId,
        managerUserId: employee.business.userId,
        employeeName: employee.name,
      });
      adminEmailed = true;
    }
  }

  const after = await prisma.employee.findUnique({
    where: { id: args.employeeId },
    select: { receivingPausedAt: true },
  });
  const outcome: EmployeeInactivityOutcome = after?.receivingPausedAt
    ? "paused"
    : evaluation.outcome === "warned" || warningSent
      ? "warned"
      : evaluation.outcome;

  return { outcome, warningSent, pausedNow, adminEmailed };
}

export async function tickEmployeeStripeInactivity(now = new Date()): Promise<{
  scanned: number;
  active: number;
  warned: number;
  paused: number;
  skippedNotReceivable: number;
  warningsSent: number;
  adminEmailsQueued: number;
  stripeActionsAttempted: number;
}> {
  const employees = await prisma.employee.findMany({
    where: { isDeleted: false },
    select: {
      id: true,
      isActive: true,
      activationStatus: true,
      createdAt: true,
      receivingPausedAt: true,
      receivingResumedAt: true,
    },
  });
  const lastPayables = await prisma.employeeTipPayable.groupBy({
    by: ["employeeId"],
    _max: { createdAt: true },
  });
  const lastByEmployee = new Map(lastPayables.map((row) => [row.employeeId, row._max.createdAt]));

  const dueIds: string[] = [];
  for (const emp of employees) {
    const lastEligible = lastByEmployee.get(emp.id)
      ? maxDate([lastByEmployee.get(emp.id) ?? null, emp.receivingResumedAt])
      : (emp.receivingResumedAt ?? emp.createdAt);
    const days = daysBetween(now, lastEligible);
    if (emp.receivingPausedAt || days >= EMPLOYEE_STRIPE_INACTIVITY_WARNING_DAYS) {
      dueIds.push(emp.id);
    }
  }

  let active = employees.length - dueIds.length;
  let warned = 0;
  let paused = 0;
  let skippedNotReceivable = 0;
  let warningsSent = 0;
  let adminEmailsQueued = 0;

  for (const employeeId of dueIds) {
    const applied = await processEmployeeCareTipInactivity({ employeeId, now });
    if (applied.warningSent) warningsSent += 1;
    if (applied.adminEmailed) adminEmailsQueued += 1;
    if (applied.outcome === "active") active += 1;
    else if (applied.outcome === "warned") warned += 1;
    else if (applied.outcome === "paused") paused += 1;
    else skippedNotReceivable += 1;
  }

  return {
    scanned: employees.length,
    active,
    warned,
    paused,
    skippedNotReceivable,
    warningsSent,
    adminEmailsQueued,
    stripeActionsAttempted: 0,
  };
}

export async function reactivateEmployeeReceivingForUser(userId: string): Promise<{
  receivingPaused: boolean;
}> {
  const employee = await prisma.employee.findFirst({
    where: { userId, isDeleted: false },
    select: {
      id: true,
      receivingPausedAt: true,
      receivingPausedReason: true,
      isActive: true,
    },
  });
  if (!employee) {
    throw new StripeConnectError("Employee not found", "EMPLOYEE_NOT_FOUND", 404);
  }
  if (!employee.isActive) {
    throw new StripeConnectError(
      "This profile cannot be reactivated here. Ask your venue manager.",
      "EMPLOYEE_MANAGER_INACTIVE",
      400,
    );
  }
  if (!employee.receivingPausedAt) {
    return { receivingPaused: false };
  }
  if (employee.receivingPausedReason && employee.receivingPausedReason !== EMPLOYEE_RECEIVING_PAUSED_NO_ELIGIBLE_TIP) {
    throw new StripeConnectError("This profile cannot be reactivated here.", "EMPLOYEE_PAUSE_NOT_INACTIVITY", 400);
  }

  const now = new Date();
  await prisma.employee.update({
    where: { id: employee.id },
    data: {
      receivingPausedAt: null,
      receivingPausedReason: null,
      receivingResumedAt: now,
      inactivityWarningSentAt: null,
      inactivityAdminNotifiedAt: null,
    },
  });
  console.info(
    JSON.stringify({
      event: "employee_caretip_receiving_resumed",
      employeeId: employee.id,
      explicitClick: true,
    }),
  );
  return { receivingPaused: false };
}
