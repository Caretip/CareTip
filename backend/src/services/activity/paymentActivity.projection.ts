import { ActivityEventSource } from "@prisma/client";
import { prisma } from "../../prisma.js";
import {
  ACTIVITY_EVENT_TYPES,
  projectBusinessActivityEvent,
} from "./businessActivityEvent.service.js";
import { scheduleIsolatedActivityWork } from "./activityProjection.isolation.js";

/** After pending→failed commit when update count > 0. */
export function schedulePaymentFailedProjection(input: {
  paymentIntentId: string;
  transactionId: string;
  businessId: string;
  employeeId: string | null;
  amountEur: number;
  employeeName?: string | null;
  reason: "payment_intent_failed" | "canceled";
}): void {
  projectBusinessActivityEvent({
    businessId: input.businessId,
    type: ACTIVITY_EVENT_TYPES.PAYMENT_FAILED,
    source: ActivityEventSource.PAYMENTS,
    occurredAt: new Date(),
    dedupeKey: `pi:${input.paymentIntentId}:failed`,
    subjectType: "tip",
    subjectId: input.transactionId,
    actorEmployeeId: input.employeeId,
    summary: {
      amountEur: input.amountEur,
      employeeName: input.employeeName ?? null,
      paymentIntentId: input.paymentIntentId,
      transactionId: input.transactionId,
      reason: input.reason,
    },
  });
}

/** After failed tip persist + successful Stripe refund. Never emits payment.failed twin. */
export function schedulePaymentRefundedProjection(input: {
  paymentIntentId: string;
  refundId: string;
  transactionId: string;
  businessId: string;
  employeeId: string | null;
  amountEur: number;
  employeeName?: string | null;
}): void {
  projectBusinessActivityEvent({
    businessId: input.businessId,
    type: ACTIVITY_EVENT_TYPES.PAYMENT_REFUNDED,
    source: ActivityEventSource.PAYMENTS,
    occurredAt: new Date(),
    dedupeKey: `refund:${input.refundId}`,
    subjectType: "tip",
    subjectId: input.transactionId,
    actorEmployeeId: input.employeeId,
    summary: {
      amountEur: input.amountEur,
      employeeName: input.employeeName ?? null,
      paymentIntentId: input.paymentIntentId,
      refundId: input.refundId,
      transactionId: input.transactionId,
      reason: "eligibility_failure",
    },
  });
}

/**
 * Load tip after pending→failed and project payment.failed (isolated).
 */
export function schedulePaymentFailedAfterPendingUpdate(
  paymentIntentId: string,
  updatedCount: number,
  reason: "payment_intent_failed" | "canceled" = "payment_intent_failed",
): void {
  if (updatedCount <= 0) return;
  scheduleIsolatedActivityWork(
    "payment.failed",
    async () => {
      const tip = await prisma.transaction.findFirst({
        where: { stripePaymentIntentId: paymentIntentId, status: "failed" },
        select: {
          id: true,
          businessId: true,
          employeeId: true,
          amount: true,
          employee: { select: { name: true } },
        },
      });
      if (!tip) return;
      schedulePaymentFailedProjection({
        paymentIntentId,
        transactionId: tip.id,
        businessId: tip.businessId,
        employeeId: tip.employeeId,
        amountEur: Number(tip.amount),
        employeeName: tip.employee?.name ?? null,
        reason,
      });
    },
    { paymentIntentId, updatedCount },
  );
}
