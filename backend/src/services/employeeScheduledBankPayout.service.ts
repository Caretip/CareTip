/**
 * CareTip-initiated standard bank payouts for employee every_3_days preference.
 * Operates on the employee Stripe Connect balance (after CareTip transfers), not tip release.
 */
import {
  BusinessBankPayoutSchedule,
  type EmployeeStripeScheduledPayoutRequest,
  StripeConnectScheduledPayoutRequestStatus,
} from "@prisma/client";
import type Stripe from "stripe";
import { prisma } from "../prisma.js";
import { runSerializedByKey } from "../utils/serializedByKey.js";
import { logServerError } from "../utils/httpErrors.js";
import { isPrismaUniqueViolation } from "../utils/prismaErrors.js";
import { getStripeClient, isStripeConfigured } from "./stripe.service.js";
import {
  computeNextEvery3DaysPayoutAt,
  scheduleWindowKeyFromDate,
} from "./businessBankPayoutSchedule.service.js";
import { persistEmployeePayoutFromStripeObject } from "./employeeStripePayout.service.js";

const EUR_STANDARD_MIN_CENTS = 100;

type CreateStandardPayoutFn = (args: {
  stripeAccountId: string;
  amountCents: number;
  currency: string;
  idempotencyKey: string;
}) => Promise<Stripe.Payout>;

type RetrieveBalanceFn = (stripeAccountId: string) => Promise<Stripe.Balance>;
type ListPendingPayoutsFn = (stripeAccountId: string) => Promise<boolean>;

let createStandardPayoutFn: CreateStandardPayoutFn | null = null;
let retrieveBalanceFn: RetrieveBalanceFn | null = null;
let listPendingPayoutsFn: ListPendingPayoutsFn | null = null;

export function __setEmployeeScheduledBankPayoutStripeFnsForTests(fns: {
  createStandardPayout?: CreateStandardPayoutFn | null;
  retrieveBalance?: RetrieveBalanceFn | null;
  listPendingPayouts?: ListPendingPayoutsFn | null;
}): void {
  createStandardPayoutFn =
    fns.createStandardPayout === undefined ? createStandardPayoutFn : fns.createStandardPayout;
  retrieveBalanceFn = fns.retrieveBalance === undefined ? retrieveBalanceFn : fns.retrieveBalance;
  listPendingPayoutsFn =
    fns.listPendingPayouts === undefined ? listPendingPayoutsFn : fns.listPendingPayouts;
}

export function __resetEmployeeScheduledBankPayoutStripeFnsForTests(): void {
  createStandardPayoutFn = null;
  retrieveBalanceFn = null;
  listPendingPayoutsFn = null;
}

function balanceAvailableCents(balance: Stripe.Balance, currency: string): number {
  const row = (balance.available ?? []).find((e) => String(e.currency).toLowerCase() === currency);
  return typeof row?.amount === "number" && Number.isInteger(row.amount) ? row.amount : 0;
}

function primaryCurrency(balance: Stripe.Balance): string {
  const rows = [...(balance.available ?? []), ...(balance.pending ?? [])];
  const eur = rows.find((r) => String(r.currency).toLowerCase() === "eur");
  return String((eur ?? rows[0])?.currency ?? "eur").toLowerCase().slice(0, 8);
}

async function retrieveBalance(stripeAccountId: string): Promise<Stripe.Balance> {
  if (retrieveBalanceFn) return retrieveBalanceFn(stripeAccountId);
  return getStripeClient().balance.retrieve({}, { stripeAccount: stripeAccountId });
}

async function hasPendingStandardPayout(stripeAccountId: string): Promise<boolean> {
  if (listPendingPayoutsFn) return listPendingPayoutsFn(stripeAccountId);
  const page = await getStripeClient().payouts.list(
    { status: "pending", limit: 1 },
    { stripeAccount: stripeAccountId },
  );
  return page.data.length > 0;
}

async function createStandardPayout(args: {
  stripeAccountId: string;
  amountCents: number;
  currency: string;
  idempotencyKey: string;
}): Promise<Stripe.Payout> {
  if (createStandardPayoutFn) return createStandardPayoutFn(args);
  return getStripeClient().payouts.create(
    { amount: args.amountCents, currency: args.currency },
    { stripeAccount: args.stripeAccountId, idempotencyKey: args.idempotencyKey },
  );
}

export function employeeScheduledBankPayoutStripeIdempotencyKey(employeeId: string, dueAt: Date): string {
  const windowKey = scheduleWindowKeyFromDate(dueAt);
  return `caretip_employee_scheduled_payout:${employeeId}:${windowKey}`;
}

type EmployeeScheduledPayoutLedgerCreate = {
  employeeId: string;
  scheduleWindowKey: string;
  idempotencyKey: string;
  amountCents: number;
  currency: string;
  status: StripeConnectScheduledPayoutRequestStatus;
};

async function findEmployeeScheduledPayoutLedgerRow(
  employeeId: string,
  scheduleWindowKey: string,
): Promise<EmployeeStripeScheduledPayoutRequest | null> {
  return prisma.employeeStripeScheduledPayoutRequest.findUnique({
    where: { employeeId_scheduleWindowKey: { employeeId, scheduleWindowKey } },
  });
}

async function createEmployeeScheduledPayoutLedgerRowOrGetExisting(
  data: EmployeeScheduledPayoutLedgerCreate,
): Promise<{ row: EmployeeStripeScheduledPayoutRequest; created: boolean }> {
  const existing = await findEmployeeScheduledPayoutLedgerRow(data.employeeId, data.scheduleWindowKey);
  if (existing) return { row: existing, created: false };
  try {
    const row = await prisma.employeeStripeScheduledPayoutRequest.create({ data });
    return { row, created: true };
  } catch (err) {
    if (!isPrismaUniqueViolation(err)) throw err;
    for (let attempt = 0; attempt < 4; attempt++) {
      const raced =
        (await findEmployeeScheduledPayoutLedgerRow(data.employeeId, data.scheduleWindowKey)) ??
        (await prisma.employeeStripeScheduledPayoutRequest.findUnique({
          where: { idempotencyKey: data.idempotencyKey },
        }));
      if (raced) return { row: raced, created: false };
      await new Promise((resolve) => setTimeout(resolve, 15 * (attempt + 1)));
    }
    throw err;
  }
}

async function advanceEmployeeEvery3DaysWindow(employeeId: string, previousAnchorUtc: Date): Promise<void> {
  const row = await prisma.employeeStripeAccount.findUnique({
    where: { employeeId },
    select: { employee: { select: { business: { select: { timezone: true } } } } },
  });
  if (!row) return;
  const next = computeNextEvery3DaysPayoutAt({
    timezone: row.employee.business.timezone,
    previousAnchorUtc,
  });
  await prisma.employeeStripeAccount.update({
    where: { employeeId },
    data: { bankPayoutNextScheduledAt: next },
  });
}

export async function runScheduledBankPayoutForEmployee(employeeId: string): Promise<{
  outcome: "skipped" | "created" | "zero" | "not_due" | "blocked";
  stripePayoutId?: string;
}> {
  if (!isStripeConfigured() && !createStandardPayoutFn) {
    return { outcome: "skipped" };
  }

  return runSerializedByKey(`scheduled-bank-payout:employee:${employeeId}`, async () => {
    const account = await prisma.employeeStripeAccount.findUnique({
      where: { employeeId },
      select: {
        employeeId: true,
        bankPayoutSchedule: true,
        bankPayoutNextScheduledAt: true,
        stripeAccountId: true,
        stripePayoutsEnabled: true,
        employee: {
          select: {
            isDeleted: true,
            isActive: true,
            activationStatus: true,
            user: { select: { legalHold: true, isActive: true } },
            business: { select: { deletedAt: true, legalHold: true } },
          },
        },
      },
    });
    if (!account) return { outcome: "skipped" };
    if (account.bankPayoutSchedule !== BusinessBankPayoutSchedule.every_3_days) {
      return { outcome: "skipped" };
    }
    const emp = account.employee;
    if (
      emp.isDeleted ||
      !emp.isActive ||
      emp.activationStatus !== "active" ||
      !emp.user?.isActive ||
      emp.user.legalHold ||
      emp.business.deletedAt ||
      emp.business.legalHold
    ) {
      return { outcome: "blocked" };
    }
    const stripeAccountId = account.stripeAccountId?.trim();
    if (!stripeAccountId || !account.stripePayoutsEnabled) return { outcome: "blocked" };

    const dueAt = account.bankPayoutNextScheduledAt;
    if (!dueAt || dueAt.getTime() > Date.now()) return { outcome: "not_due" };

    const windowKey = scheduleWindowKeyFromDate(dueAt);
    const idempotencyKey = employeeScheduledBankPayoutStripeIdempotencyKey(employeeId, dueAt);

    const existing = await findEmployeeScheduledPayoutLedgerRow(employeeId, windowKey);
    if (existing?.status === StripeConnectScheduledPayoutRequestStatus.submitted && existing.stripePayoutId) {
      await advanceEmployeeEvery3DaysWindow(employeeId, dueAt);
      return { outcome: "created", stripePayoutId: existing.stripePayoutId };
    }
    if (existing?.status === StripeConnectScheduledPayoutRequestStatus.skipped_zero_balance) {
      await advanceEmployeeEvery3DaysWindow(employeeId, dueAt);
      return { outcome: "zero" };
    }

    if (await hasPendingStandardPayout(stripeAccountId)) {
      return { outcome: "blocked" };
    }

    const balance = await retrieveBalance(stripeAccountId);
    const currency = primaryCurrency(balance);
    const availableCents = balanceAvailableCents(balance, currency);

    if (availableCents < EUR_STANDARD_MIN_CENTS) {
      const { row } = await createEmployeeScheduledPayoutLedgerRowOrGetExisting({
        employeeId,
        scheduleWindowKey: windowKey,
        idempotencyKey,
        amountCents: 0,
        currency,
        status: StripeConnectScheduledPayoutRequestStatus.skipped_zero_balance,
      });
      if (row.status !== StripeConnectScheduledPayoutRequestStatus.skipped_zero_balance) {
        await prisma.employeeStripeScheduledPayoutRequest.update({
          where: { id: row.id },
          data: { status: StripeConnectScheduledPayoutRequestStatus.skipped_zero_balance },
        });
      }
      await advanceEmployeeEvery3DaysWindow(employeeId, dueAt);
      return { outcome: "zero" };
    }

    const { row: request, created: ledgerCreated } =
      await createEmployeeScheduledPayoutLedgerRowOrGetExisting({
        employeeId,
        scheduleWindowKey: windowKey,
        idempotencyKey,
        amountCents: availableCents,
        currency,
        status: StripeConnectScheduledPayoutRequestStatus.pending,
      });

    if (
      request.status === StripeConnectScheduledPayoutRequestStatus.submitted &&
      request.stripePayoutId
    ) {
      await advanceEmployeeEvery3DaysWindow(employeeId, dueAt);
      return { outcome: "created", stripePayoutId: request.stripePayoutId };
    }
    if (request.status === StripeConnectScheduledPayoutRequestStatus.skipped_zero_balance) {
      await advanceEmployeeEvery3DaysWindow(employeeId, dueAt);
      return { outcome: "zero" };
    }
    if (request.status === StripeConnectScheduledPayoutRequestStatus.failed) {
      return { outcome: "blocked" };
    }
    if (!ledgerCreated && request.status === StripeConnectScheduledPayoutRequestStatus.pending) {
      return { outcome: "blocked" };
    }

    let stripePayout: Stripe.Payout;
    try {
      stripePayout = await createStandardPayout({
        stripeAccountId,
        amountCents: availableCents,
        currency,
        idempotencyKey,
      });
    } catch (err) {
      logServerError("employeeScheduledBankPayout.create", err, { employeeId, windowKey });
      await prisma.employeeStripeScheduledPayoutRequest.update({
        where: { id: request.id },
        data: {
          status: StripeConnectScheduledPayoutRequestStatus.failed,
          failureCode: "stripe_create_failed",
        },
      });
      return { outcome: "blocked" };
    }

    await prisma.employeeStripeScheduledPayoutRequest.update({
      where: { id: request.id },
      data: {
        status: StripeConnectScheduledPayoutRequestStatus.submitted,
        stripePayoutId: stripePayout.id,
        amountCents: availableCents,
      },
    });

    await persistEmployeePayoutFromStripeObject({
      employeeId,
      stripeAccountId,
      payout: stripePayout,
    });
    await advanceEmployeeEvery3DaysWindow(employeeId, dueAt);
    return { outcome: "created", stripePayoutId: stripePayout.id };
  });
}

export type ScheduledBankPayoutTickCounts = {
  scanned: number;
  created: number;
  zero: number;
  blocked: number;
  notDue: number;
};

export async function tickEmployeeScheduledBankPayouts(): Promise<ScheduledBankPayoutTickCounts> {
  const now = new Date();
  const dueEmployees = await prisma.employeeStripeAccount.findMany({
    where: {
      bankPayoutSchedule: BusinessBankPayoutSchedule.every_3_days,
      bankPayoutNextScheduledAt: { lte: now },
      stripePayoutsEnabled: true,
      employee: {
        isDeleted: false,
        isActive: true,
        activationStatus: "active",
        user: { isActive: true, legalHold: false },
        business: { deletedAt: null, legalHold: false },
      },
    },
    select: { employeeId: true },
    take: 50,
  });

  let created = 0;
  let zero = 0;
  let blocked = 0;
  let notDue = 0;

  for (const row of dueEmployees) {
    try {
      const result = await runScheduledBankPayoutForEmployee(row.employeeId);
      if (result.outcome === "created") created += 1;
      else if (result.outcome === "zero") zero += 1;
      else if (result.outcome === "blocked") blocked += 1;
      else if (result.outcome === "not_due") notDue += 1;
    } catch (err) {
      logServerError("employeeScheduledBankPayout.tick.employee", err, {
        employeeId: row.employeeId,
      });
      blocked += 1;
    }
  }

  return { scanned: dueEmployees.length, created, zero, blocked, notDue };
}
