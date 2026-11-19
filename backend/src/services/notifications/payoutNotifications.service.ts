/**
 * Payout notifications from authoritative Stripe payout records.
 *
 * Source of truth: EmployeeStripePayout (payouts on an employee's own Connect account) and
 * StripeConnectPayout (payouts on a business account). Both are written only from verified
 * Stripe webhooks or fresh Stripe API reads, with out-of-order protection. Nothing here infers a
 * payout from tips, transfers, allocations or balances, so a refund, dispute or tip reversal never
 * produces a payout message.
 *
 * Statuses and wording:
 * - pending / in_transit → "payout started" (Stripe created the payout)
 * - paid → "sent to your bank" (Stripe's paid status; worded so it does not claim arrival)
 * - failed → "could not be completed" (Stripe returns the funds to the Stripe balance)
 * - canceled → "cancelled"
 * A paid payout that the bank later returns is recorded in stripe_payout_returns (the payout row
 * keeps its paid history) and reported with its own "returned" message.
 *
 * Reliability: one logical notification per payout and status (dedupe key with a unique index), so
 * duplicate webhooks, sync reruns and concurrent processing cannot notify twice. A crash between the
 * payout write and the notification is repaired by sweepRecentPayoutNotifications().
 */
import { StripeConnectPayoutStatus } from "@prisma/client";
import { prisma } from "../../prisma.js";
import { NotificationType } from "../push/notification.types.js";
import { deliverUserNotification } from "./notificationOrchestrator.service.js";
import type { NotificationTemplate } from "../../notifications/notificationI18n.js";

/** Payouts created before this are history (first sync of an account), not news. */
export const PAYOUT_NOTIFICATION_MAX_AGE_MS = 14 * 24 * 60 * 60_000;
const SWEEP_WINDOW_MS = 48 * 60 * 60_000;

type Stage = "started" | "paid" | "failed" | "canceled";
type DedupeStage = Stage | "returned";

export function payoutStage(status: StripeConnectPayoutStatus): Stage | null {
  switch (status) {
    case StripeConnectPayoutStatus.pending:
    case StripeConnectPayoutStatus.in_transit:
      return "started";
    case StripeConnectPayoutStatus.paid:
      return "paid";
    case StripeConnectPayoutStatus.failed:
      return "failed";
    case StripeConnectPayoutStatus.canceled:
      return "canceled";
    default:
      return null;
  }
}

export function payoutDedupeKey(stripePayoutId: string, stage: DedupeStage): string {
  return `payout:${stripePayoutId}:${stage}`;
}

let clockForTests: (() => number) | null = null;
export function __setPayoutNotificationClockForTests(fn: (() => number) | null): void {
  clockForTests = fn;
}
const nowMs = () => (clockForTests ? clockForTests() : Date.now());

export type PayoutNotifyOutcome =
  | "notified"
  | "already_notified"
  | "too_old"
  | "no_stage"
  | "no_recipient"
  | "not_found";

/** Employee payout row changed: tell the employee whose Connect account it is. */
export async function notifyEmployeePayoutChange(payoutRowId: string): Promise<PayoutNotifyOutcome> {
  const payout = await prisma.employeeStripePayout.findUnique({
    where: { id: payoutRowId },
    select: {
      id: true,
      stripePayoutId: true,
      employeeId: true,
      businessId: true,
      amountCents: true,
      currency: true,
      status: true,
      arrivalDate: true,
      stripeCreatedAt: true,
      employee: {
        select: {
          businessId: true,
          isDeleted: true,
          user: { select: { id: true, isActive: true } },
        },
      },
    },
  });
  if (!payout) return "not_found";
  const stage = payoutStage(payout.status);
  if (!stage) return "no_stage";
  if (nowMs() - payout.stripeCreatedAt.getTime() > PAYOUT_NOTIFICATION_MAX_AGE_MS) return "too_old";

  // Recipient strictly from the payout's own employee, inside the payout's business.
  const user = payout.employee.user;
  if (!user?.isActive || payout.employee.isDeleted || payout.employee.businessId !== payout.businessId) {
    return "no_recipient";
  }

  const dedupeKey = payoutDedupeKey(payout.stripePayoutId, stage);
  if (await alreadyNotified(user.id, dedupeKey)) return "already_notified";

  const params = {
    amountCents: payout.amountCents,
    currency: payout.currency,
    arrivalDateIso: payout.arrivalDate?.toISOString() ?? null,
  };
  const template: NotificationTemplate =
    stage === "started"
      ? { id: "employee_payout_started", params }
      : stage === "paid"
        ? { id: "employee_payout_paid", params }
        : stage === "failed"
          ? { id: "employee_payout_failed", params }
          : { id: "employee_payout_canceled", params };

  const result = await deliverUserNotification({
    userId: user.id,
    payload: {
      type: NotificationType.PAYOUT_COMPLETED,
      title: fallbackTitle(stage),
      body: fallbackTitle(stage),
      localeTemplate: template,
      url: "/employee/payments/history",
      timestamp: new Date().toISOString(),
      metadata: {
        entityId: payout.id,
        payoutId: payout.id,
        payoutStage: stage,
        businessId: payout.businessId,
        employeeId: payout.employeeId,
      },
    },
    // Only a failure needs action, so only a failure is emailed.
    channels: { in_app: true, push: true, email: stage === "failed" },
    priority: stage === "failed" ? "high" : "normal",
    dedupeKey,
  });
  return result.skipped ? "already_notified" : "notified";
}

/** Business payout row changed: only a failure is worth telling the owner about. */
export async function notifyBusinessPayoutChange(payoutRowId: string): Promise<PayoutNotifyOutcome> {
  const payout = await prisma.stripeConnectPayout.findUnique({
    where: { id: payoutRowId },
    select: {
      id: true,
      stripePayoutId: true,
      businessId: true,
      amountCents: true,
      currency: true,
      status: true,
      stripeCreatedAt: true,
      business: { select: { userId: true, user: { select: { isActive: true } } } },
    },
  });
  if (!payout) return "not_found";
  if (payout.status !== StripeConnectPayoutStatus.failed) return "no_stage";
  if (nowMs() - payout.stripeCreatedAt.getTime() > PAYOUT_NOTIFICATION_MAX_AGE_MS) return "too_old";
  const ownerId = payout.business.userId;
  if (!ownerId || !payout.business.user?.isActive) return "no_recipient";

  const dedupeKey = payoutDedupeKey(payout.stripePayoutId, "failed");
  if (await alreadyNotified(ownerId, dedupeKey)) return "already_notified";

  const result = await deliverUserNotification({
    userId: ownerId,
    payload: {
      type: NotificationType.PAYOUT_COMPLETED,
      title: "Business payout could not be completed",
      body: "A payout to your business bank account could not be completed.",
      localeTemplate: {
        id: "business_payout_failed",
        params: { amountCents: payout.amountCents, currency: payout.currency },
      },
      url: "/dashboard/stripe/payouts",
      timestamp: new Date().toISOString(),
      metadata: { entityId: payout.id, payoutId: payout.id, payoutStage: "failed", businessId: payout.businessId },
    },
    channels: { in_app: true, push: true, email: true },
    priority: "high",
    dedupeKey,
  });
  return result.skipped ? "already_notified" : "notified";
}

async function alreadyNotified(userId: string, dedupeKey: string): Promise<boolean> {
  const hit = await prisma.notification.findFirst({ where: { userId, dedupeKey }, select: { id: true } });
  return hit != null;
}

function fallbackTitle(stage: Stage): string {
  return stage === "started"
    ? "Payout started"
    : stage === "paid"
      ? "Payout sent to your bank"
      : stage === "failed"
        ? "Payout could not be completed"
        : "Payout cancelled";
}

/**
 * Repair pass: payouts changed in the last 48 hours whose notification is missing (for example
 * the process stopped between the payout write and the notification). Idempotent.
 */
export async function sweepRecentPayoutNotifications(opts?: { limit?: number }): Promise<{ checked: number; notified: number }> {
  const limit = Math.max(1, Math.min(opts?.limit ?? 50, 200));
  const since = new Date(nowMs() - SWEEP_WINDOW_MS);
  const createdAfter = new Date(nowMs() - PAYOUT_NOTIFICATION_MAX_AGE_MS);
  const [employeeRows, businessRows] = await Promise.all([
    prisma.employeeStripePayout.findMany({
      where: { updatedAt: { gte: since }, stripeCreatedAt: { gte: createdAfter } },
      orderBy: { updatedAt: "asc" },
      take: limit,
      select: { id: true },
    }),
    prisma.stripeConnectPayout.findMany({
      where: {
        status: StripeConnectPayoutStatus.failed,
        updatedAt: { gte: since },
        stripeCreatedAt: { gte: createdAfter },
      },
      orderBy: { updatedAt: "asc" },
      take: limit,
      select: { id: true },
    }),
  ]);
  let notified = 0;
  for (const r of employeeRows) {
    if ((await notifyEmployeePayoutChange(r.id)) === "notified") notified += 1;
  }
  for (const r of businessRows) {
    if ((await notifyBusinessPayoutChange(r.id)) === "notified") notified += 1;
  }
  const returns = await sweepRecentPayoutReturnNotifications({ limit });
  notified += returns.notified;
  if (notified > 0) console.warn("[payoutNotifications] sweep repaired missing notifications", { notified });
  return { checked: employeeRows.length + businessRows.length + returns.checked, notified };
}

/* ---------------- Returned payouts (paid, then sent back by the bank) ---------------- */

/**
 * Employee payout returned by the bank. Skipped when the employee was already told the payout
 * failed (Stripe delivered the failure before the paid event), so they never get two messages
 * about one outcome. The wording never says the money is available: Stripe restores it to the
 * Stripe balance, which the employee sees there once the return completes.
 */
export async function notifyEmployeePayoutReturn(payoutRowId: string): Promise<PayoutNotifyOutcome> {
  const payout = await prisma.employeeStripePayout.findUnique({
    where: { id: payoutRowId },
    select: {
      id: true,
      stripePayoutId: true,
      employeeId: true,
      businessId: true,
      amountCents: true,
      currency: true,
      stripeCreatedAt: true,
      employee: { select: { businessId: true, isDeleted: true, user: { select: { id: true, isActive: true } } } },
    },
  });
  if (!payout) return "not_found";
  if (nowMs() - payout.stripeCreatedAt.getTime() > PAYOUT_NOTIFICATION_MAX_AGE_MS) return "too_old";
  const user = payout.employee.user;
  if (!user?.isActive || payout.employee.isDeleted || payout.employee.businessId !== payout.businessId) {
    return "no_recipient";
  }
  const dedupeKey = payoutDedupeKey(payout.stripePayoutId, "returned");
  if (await alreadyNotified(user.id, dedupeKey)) return "already_notified";
  if (await alreadyNotified(user.id, payoutDedupeKey(payout.stripePayoutId, "failed"))) return "already_notified";

  const result = await deliverUserNotification({
    userId: user.id,
    payload: {
      type: NotificationType.PAYOUT_COMPLETED,
      title: "Payout returned by your bank",
      body: "Your payout was returned by your bank.",
      localeTemplate: {
        id: "employee_payout_returned",
        params: { amountCents: payout.amountCents, currency: payout.currency },
      },
      url: "/employee/payments/history",
      timestamp: new Date().toISOString(),
      metadata: {
        entityId: payout.id,
        payoutId: payout.id,
        payoutStage: "returned",
        businessId: payout.businessId,
        employeeId: payout.employeeId,
      },
    },
    channels: { in_app: true, push: true, email: true },
    priority: "high",
    dedupeKey,
  });
  return result.skipped ? "already_notified" : "notified";
}

/** Business payout returned by the bank: tell that business's owner only. */
export async function notifyBusinessPayoutReturn(payoutRowId: string): Promise<PayoutNotifyOutcome> {
  const payout = await prisma.stripeConnectPayout.findUnique({
    where: { id: payoutRowId },
    select: {
      id: true,
      stripePayoutId: true,
      businessId: true,
      amountCents: true,
      currency: true,
      stripeCreatedAt: true,
      business: { select: { userId: true, user: { select: { isActive: true } } } },
    },
  });
  if (!payout) return "not_found";
  if (nowMs() - payout.stripeCreatedAt.getTime() > PAYOUT_NOTIFICATION_MAX_AGE_MS) return "too_old";
  const ownerId = payout.business.userId;
  if (!ownerId || !payout.business.user?.isActive) return "no_recipient";
  const dedupeKey = payoutDedupeKey(payout.stripePayoutId, "returned");
  if (await alreadyNotified(ownerId, dedupeKey)) return "already_notified";
  if (await alreadyNotified(ownerId, payoutDedupeKey(payout.stripePayoutId, "failed"))) return "already_notified";

  const result = await deliverUserNotification({
    userId: ownerId,
    payload: {
      type: NotificationType.PAYOUT_COMPLETED,
      title: "Business payout returned by the bank",
      body: "A payout to your business bank account was returned by the bank.",
      localeTemplate: {
        id: "business_payout_returned",
        params: { amountCents: payout.amountCents, currency: payout.currency },
      },
      url: "/dashboard/stripe/payouts",
      timestamp: new Date().toISOString(),
      metadata: { entityId: payout.id, payoutId: payout.id, payoutStage: "returned", businessId: payout.businessId },
    },
    channels: { in_app: true, push: true, email: true },
    priority: "high",
    dedupeKey,
  });
  return result.skipped ? "already_notified" : "notified";
}

/** Repair pass for returns recorded in the last 48 hours whose notification is missing. Idempotent. */
export async function sweepRecentPayoutReturnNotifications(opts?: { limit?: number }): Promise<{ checked: number; notified: number }> {
  const { listRecentPayoutReturns } = await import("../payoutReturns.service.js");
  const limit = Math.max(1, Math.min(opts?.limit ?? 50, 200));
  let rows: Awaited<ReturnType<typeof listRecentPayoutReturns>>;
  try {
    rows = await listRecentPayoutReturns(new Date(nowMs() - SWEEP_WINDOW_MS), limit);
  } catch (err) {
    if (/stripe_payout_returns/.test(String((err as Error)?.message ?? err))) return { checked: 0, notified: 0 };
    throw err;
  }
  let notified = 0;
  for (const r of rows) {
    const outcome =
      r.payout_kind === "employee"
        ? await notifyEmployeePayoutReturn(r.payout_row_id)
        : await notifyBusinessPayoutReturn(r.payout_row_id);
    if (outcome === "notified") notified += 1;
  }
  return { checked: rows.length, notified };
}
