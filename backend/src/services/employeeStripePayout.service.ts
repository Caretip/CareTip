/**
 * Employee Stripe → bank/card payout observation.
 * Distinct from StripeConnectPayout (business) and EmployeeTipPayable (CareTip transfer).
 */
import { StripeConnectPayoutStatus } from "@prisma/client";
import { prisma } from "../prisma.js";
import { runSerializedByKey } from "../utils/serializedByKey.js";
import {
  parsePayoutObject,
  shouldApplyPayoutEvent,
  type HandleConnectPayoutResult,
} from "./stripeConnectPayout.service.js";
import type Stripe from "stripe";

function accountSuffix(accountId: string): string {
  return accountId.length <= 8 ? accountId : accountId.slice(-8);
}

export async function persistEmployeeConnectPayout(args: {
  employeeId: string;
  stripeAccountId: string;
  parsed: NonNullable<ReturnType<typeof parsePayoutObject>>;
  eventCreated: number;
  eventType: string;
  eventId: string | null;
}): Promise<HandleConnectPayoutResult> {
  const { employeeId, stripeAccountId: accountId, parsed, eventCreated, eventType, eventId } = args;

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, businessId: true, isDeleted: true },
  });
  if (!employee) {
    return { matched: false, reason: "unknown_employee" };
  }

  return runSerializedByKey(`employee-connect-payout:${parsed.stripePayoutId}`, async () => {
    const now = new Date();
    const existing = await prisma.employeeStripePayout.findUnique({
      where: { stripePayoutId: parsed.stripePayoutId },
    });

    if (existing) {
      if (existing.employeeId !== employeeId || existing.stripeAccountId !== accountId) {
        console.error("[stripe.employeePayout] payout_attribution_conflict", {
          payoutSuffix: parsed.stripePayoutId.slice(-8),
          accountSuffix: accountSuffix(accountId),
        });
        return { matched: false, reason: "attribution_conflict", payoutRowId: existing.id };
      }
      const decision = shouldApplyPayoutEvent({
        storedStatus: existing.status,
        storedEventCreated: existing.lastStripeEventCreated,
        incomingStatus: parsed.status,
        incomingEventCreated: eventCreated,
      });
      if (!decision.apply) {
        return {
          matched: true,
          skippedStale: true,
          payoutRowId: existing.id,
          businessId: existing.businessId,
          employeeId,
          reason: decision.reason,
        };
      }

      const paidAt =
        parsed.status === StripeConnectPayoutStatus.paid ? (existing.paidAt ?? now) : existing.paidAt;
      const failedAt =
        parsed.status === StripeConnectPayoutStatus.failed ? (existing.failedAt ?? now) : existing.failedAt;
      const canceledAt =
        parsed.status === StripeConnectPayoutStatus.canceled
          ? (existing.canceledAt ?? now)
          : existing.canceledAt;

      await prisma.employeeStripePayout.update({
        where: { id: existing.id },
        data: {
          amountCents: parsed.amountCents,
          currency: parsed.currency,
          status: parsed.status,
          arrivalDate: parsed.arrivalDate,
          method: parsed.method,
          payoutType: parsed.payoutType,
          description: parsed.description,
          applicationFeeAmountCents: parsed.applicationFeeAmountCents,
          stripeApplicationFeeId: parsed.stripeApplicationFeeId,
          failureCode:
            parsed.status === StripeConnectPayoutStatus.failed
              ? parsed.failureCode
              : existing.failureCode,
          failureMessage:
            parsed.status === StripeConnectPayoutStatus.failed
              ? parsed.failureMessage
              : existing.failureMessage,
          stripeCreatedAt: parsed.stripeCreatedAt,
          lastStripeEventCreated: eventCreated,
          lastStripeEventType: eventType.slice(0, 64),
          lastStripeEventId: eventId ? eventId.slice(0, 128) : existing.lastStripeEventId,
          paidAt,
          failedAt,
          canceledAt,
        },
      });
      console.info("[stripe.employeePayout] payout_persisted", {
        employeeId,
        payoutSuffix: parsed.stripePayoutId.slice(-8),
        reason: "updated",
        status: parsed.status,
      });
      return {
        matched: true,
        payoutRowId: existing.id,
        businessId: existing.businessId,
        employeeId,
        reason: "employee_payout",
      };
    }

    const created = await prisma.employeeStripePayout.create({
      data: {
        employeeId,
        businessId: employee.businessId,
        stripeAccountId: accountId,
        stripePayoutId: parsed.stripePayoutId,
        amountCents: parsed.amountCents,
        currency: parsed.currency,
        status: parsed.status,
        arrivalDate: parsed.arrivalDate,
        method: parsed.method,
        payoutType: parsed.payoutType,
        applicationFeeAmountCents: parsed.applicationFeeAmountCents,
        stripeApplicationFeeId: parsed.stripeApplicationFeeId,
        description: parsed.description,
        failureCode: parsed.failureCode,
        failureMessage: parsed.failureMessage,
        stripeCreatedAt: parsed.stripeCreatedAt,
        lastStripeEventCreated: eventCreated,
        lastStripeEventType: eventType.slice(0, 64),
        lastStripeEventId: eventId ? eventId.slice(0, 128) : null,
        paidAt: parsed.status === StripeConnectPayoutStatus.paid ? now : null,
        failedAt: parsed.status === StripeConnectPayoutStatus.failed ? now : null,
        canceledAt: parsed.status === StripeConnectPayoutStatus.canceled ? now : null,
      },
    });
    console.info("[stripe.employeePayout] payout_persisted", {
      employeeId,
      payoutSuffix: parsed.stripePayoutId.slice(-8),
      reason: "created",
      status: parsed.status,
    });
    return {
      matched: true,
      payoutRowId: created.id,
      businessId: employee.businessId,
      employeeId,
      reason: "employee_payout",
    };
  });
}

export async function persistEmployeePayoutFromStripeObject(args: {
  employeeId: string;
  stripeAccountId: string;
  payout: Stripe.Payout;
}): Promise<HandleConnectPayoutResult> {
  const parsed = parsePayoutObject(args.payout);
  if (!parsed) return { matched: false, reason: "invalid_payout_object" };
  return persistEmployeeConnectPayout({
    employeeId: args.employeeId,
    stripeAccountId: args.stripeAccountId,
    parsed,
    eventCreated: Math.floor(Date.now() / 1000),
    eventType: "payout.api_sync",
    eventId: null,
  });
}
