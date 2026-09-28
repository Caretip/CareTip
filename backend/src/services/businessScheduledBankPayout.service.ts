/**
 * CareTip-initiated standard bank payouts for every_3_days preference only.
 * Uses Stripe Balance available funds (not pending). Idempotent per schedule window.
 */
import {
  BusinessBankPayoutSchedule,
  type StripeConnectScheduledPayoutRequest,
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
import {
  ingestStripePayoutObjectForBusiness,
  invalidateConnectPayoutListSyncThrottle,
} from "./stripeConnectPayout.service.js";

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

export function __setScheduledBankPayoutStripeFnsForTests(fns: {
  createStandardPayout?: CreateStandardPayoutFn | null;
  retrieveBalance?: RetrieveBalanceFn | null;
  listPendingPayouts?: ListPendingPayoutsFn | null;
}): void {
  createStandardPayoutFn = fns.createStandardPayout === undefined ? createStandardPayoutFn : fns.createStandardPayout;
  retrieveBalanceFn = fns.retrieveBalance === undefined ? retrieveBalanceFn : fns.retrieveBalance;
  listPendingPayoutsFn = fns.listPendingPayouts === undefined ? listPendingPayoutsFn : fns.listPendingPayouts;
}

export function __resetScheduledBankPayoutStripeFnsForTests(): void {
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

export function scheduledBankPayoutStripeIdempotencyKey(businessId: string, dueAt: Date): string {
  const windowKey = scheduleWindowKeyFromDate(dueAt);
  return `caretip_scheduled_payout:${businessId}:${windowKey}`;
}

type ScheduledPayoutLedgerCreate = {
  businessId: string;
  scheduleWindowKey: string;
  idempotencyKey: string;
  amountCents: number;
  currency: string;
  status: StripeConnectScheduledPayoutRequestStatus;
};

async function findScheduledPayoutLedgerRow(
  businessId: string,
  scheduleWindowKey: string,
): Promise<StripeConnectScheduledPayoutRequest | null> {
  return prisma.stripeConnectScheduledPayoutRequest.findUnique({
    where: { businessId_scheduleWindowKey: { businessId, scheduleWindowKey } },
  });
}

/** Insert ledger row or load the winner's row after a concurrent P2002 (multi-instance cron). */
export async function __createScheduledPayoutLedgerRowOrGetExistingForTests(
  data: ScheduledPayoutLedgerCreate,
): Promise<{ row: StripeConnectScheduledPayoutRequest; created: boolean }> {
  return createScheduledPayoutLedgerRowOrGetExisting(data);
}

async function createScheduledPayoutLedgerRowOrGetExisting(
  data: ScheduledPayoutLedgerCreate,
): Promise<{ row: StripeConnectScheduledPayoutRequest; created: boolean }> {
  const existing = await findScheduledPayoutLedgerRow(data.businessId, data.scheduleWindowKey);
  if (existing) return { row: existing, created: false };
  try {
    const row = await prisma.stripeConnectScheduledPayoutRequest.create({ data });
    return { row, created: true };
  } catch (err) {
    if (!isPrismaUniqueViolation(err)) throw err;
    for (let attempt = 0; attempt < 4; attempt++) {
      const raced =
        (await findScheduledPayoutLedgerRow(data.businessId, data.scheduleWindowKey)) ??
        (await prisma.stripeConnectScheduledPayoutRequest.findUnique({
          where: { idempotencyKey: data.idempotencyKey },
        }));
      if (raced) return { row: raced, created: false };
      await new Promise((resolve) => setTimeout(resolve, 15 * (attempt + 1)));
    }
    throw err;
  }
}

async function advanceEvery3DaysWindow(businessId: string, previousAnchorUtc: Date): Promise<void> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { timezone: true },
  });
  if (!business) return;
  const next = computeNextEvery3DaysPayoutAt({
    timezone: business.timezone,
    previousAnchorUtc,
  });
  await prisma.business.update({
    where: { id: businessId },
    data: { bankPayoutNextScheduledAt: next },
  });
}

export async function runScheduledBankPayoutForBusiness(businessId: string): Promise<{
  outcome: "skipped" | "created" | "zero" | "not_due" | "blocked";
  stripePayoutId?: string;
}> {
  if (!isStripeConfigured() && !createStandardPayoutFn) {
    return { outcome: "skipped" };
  }

  return runSerializedByKey(`scheduled-bank-payout:${businessId}`, async () => {
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: {
        id: true,
        bankPayoutSchedule: true,
        bankPayoutNextScheduledAt: true,
        stripeAccountId: true,
        stripePayoutsEnabled: true,
        deletedAt: true,
        legalHold: true,
        timezone: true,
      },
    });
    if (!business) return { outcome: "skipped" };
    if (business.bankPayoutSchedule !== BusinessBankPayoutSchedule.every_3_days) {
      return { outcome: "skipped" };
    }
    if (business.deletedAt || business.legalHold) return { outcome: "blocked" };
    const stripeAccountId = business.stripeAccountId?.trim();
    if (!stripeAccountId || !business.stripePayoutsEnabled) return { outcome: "blocked" };

    const dueAt = business.bankPayoutNextScheduledAt;
    if (!dueAt || dueAt.getTime() > Date.now()) return { outcome: "not_due" };

    const windowKey = scheduleWindowKeyFromDate(dueAt);
    const idempotencyKey = scheduledBankPayoutStripeIdempotencyKey(businessId, dueAt);

    const existing = await findScheduledPayoutLedgerRow(businessId, windowKey);
    if (existing?.status === StripeConnectScheduledPayoutRequestStatus.submitted && existing.stripePayoutId) {
      await advanceEvery3DaysWindow(businessId, dueAt);
      return { outcome: "created", stripePayoutId: existing.stripePayoutId };
    }
    if (existing?.status === StripeConnectScheduledPayoutRequestStatus.skipped_zero_balance) {
      await advanceEvery3DaysWindow(businessId, dueAt);
      return { outcome: "zero" };
    }

    if (await hasPendingStandardPayout(stripeAccountId)) {
      return { outcome: "blocked" };
    }

    const balance = await retrieveBalance(stripeAccountId);
    const currency = primaryCurrency(balance);
    const availableCents = balanceAvailableCents(balance, currency);

    if (availableCents < EUR_STANDARD_MIN_CENTS) {
      const { row } = await createScheduledPayoutLedgerRowOrGetExisting({
        businessId,
        scheduleWindowKey: windowKey,
        idempotencyKey,
        amountCents: 0,
        currency,
        status: StripeConnectScheduledPayoutRequestStatus.skipped_zero_balance,
      });
      if (row.status !== StripeConnectScheduledPayoutRequestStatus.skipped_zero_balance) {
        await prisma.stripeConnectScheduledPayoutRequest.update({
          where: { id: row.id },
          data: { status: StripeConnectScheduledPayoutRequestStatus.skipped_zero_balance },
        });
      }
      await advanceEvery3DaysWindow(businessId, dueAt);
      return { outcome: "zero" };
    }

    const { row: request, created: ledgerCreated } = await createScheduledPayoutLedgerRowOrGetExisting({
      businessId,
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
      await advanceEvery3DaysWindow(businessId, dueAt);
      return { outcome: "created", stripePayoutId: request.stripePayoutId };
    }
    if (request.status === StripeConnectScheduledPayoutRequestStatus.skipped_zero_balance) {
      await advanceEvery3DaysWindow(businessId, dueAt);
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
      logServerError("businessScheduledBankPayout.create", err, { businessId, windowKey });
      await prisma.stripeConnectScheduledPayoutRequest.update({
        where: { id: request.id },
        data: {
          status: StripeConnectScheduledPayoutRequestStatus.failed,
          failureCode: "stripe_create_failed",
        },
      });
      return { outcome: "blocked" };
    }

    await prisma.stripeConnectScheduledPayoutRequest.update({
      where: { id: request.id },
      data: {
        status: StripeConnectScheduledPayoutRequestStatus.submitted,
        stripePayoutId: stripePayout.id,
        amountCents: availableCents,
      },
    });

    await ingestStripePayoutObjectForBusiness({
      businessId,
      stripeAccountId,
      payout: stripePayout,
      eventType: "payout.scheduled_create",
      eventId: `scheduled:${idempotencyKey}`,
    });
    invalidateConnectPayoutListSyncThrottle(businessId);
    await advanceEvery3DaysWindow(businessId, dueAt);
    return { outcome: "created", stripePayoutId: stripePayout.id };
  });
}

export async function tickBusinessScheduledBankPayouts(): Promise<{
  scanned: number;
  created: number;
  zero: number;
  blocked: number;
  notDue: number;
}> {
  const now = new Date();
  const dueBusinesses = await prisma.business.findMany({
    where: {
      bankPayoutSchedule: BusinessBankPayoutSchedule.every_3_days,
      bankPayoutNextScheduledAt: { lte: now },
      deletedAt: null,
      legalHold: false,
      stripeAccountId: { not: null },
      stripePayoutsEnabled: true,
    },
    select: { id: true },
    take: 50,
  });

  let created = 0;
  let zero = 0;
  let blocked = 0;
  let notDue = 0;

  for (const row of dueBusinesses) {
    try {
      const result = await runScheduledBankPayoutForBusiness(row.id);
      if (result.outcome === "created") created += 1;
      else if (result.outcome === "zero") zero += 1;
      else if (result.outcome === "blocked") blocked += 1;
      else if (result.outcome === "not_due") notDue += 1;
    } catch (err) {
      logServerError("businessScheduledBankPayout.tick.business", err, { businessId: row.id });
      blocked += 1;
    }
  }

  return { scanned: dueBusinesses.length, created, zero, blocked, notDue };
}

export async function tickScheduledBankPayouts(): Promise<{
  scanned: number;
  created: number;
  zero: number;
  blocked: number;
  notDue: number;
  business: Awaited<ReturnType<typeof tickBusinessScheduledBankPayouts>>;
  employee: import("./employeeScheduledBankPayout.service.js").ScheduledBankPayoutTickCounts;
}> {
  const { tickEmployeeScheduledBankPayouts } = await import("./employeeScheduledBankPayout.service.js");
  const business = await tickBusinessScheduledBankPayouts();
  const employee = await tickEmployeeScheduledBankPayouts();
  return {
    scanned: business.scanned + employee.scanned,
    created: business.created + employee.created,
    zero: business.zero + employee.zero,
    blocked: business.blocked + employee.blocked,
    notDue: business.notDue + employee.notDue,
    business,
    employee,
  };
}
