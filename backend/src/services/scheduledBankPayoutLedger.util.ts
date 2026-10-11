import type {
  EmployeeStripeScheduledPayoutRequest,
  StripeConnectScheduledPayoutRequest,
} from "@prisma/client";
import type { ScheduledPayoutLedgerSnapshot } from "./scheduledBankPayoutRecovery.service.js";

export function businessScheduledLedgerSnapshot(
  row: StripeConnectScheduledPayoutRequest,
): ScheduledPayoutLedgerSnapshot {
  return {
    id: row.id,
    status: row.status,
    scheduleWindowKey: row.scheduleWindowKey,
    idempotencyKey: row.idempotencyKey,
    amountCents: row.amountCents,
    currency: row.currency,
    stripePayoutId: row.stripePayoutId,
    failureCode: row.failureCode,
    attemptCount: row.attemptCount,
    nextRetryAt: row.nextRetryAt,
    failureClassification: row.failureClassification,
    reconciliationStatus: row.reconciliationStatus,
    correlationId: row.correlationId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function employeeScheduledLedgerSnapshot(
  row: EmployeeStripeScheduledPayoutRequest,
): ScheduledPayoutLedgerSnapshot {
  return {
    id: row.id,
    status: row.status,
    scheduleWindowKey: row.scheduleWindowKey,
    idempotencyKey: row.idempotencyKey,
    amountCents: row.amountCents,
    currency: row.currency,
    stripePayoutId: row.stripePayoutId,
    failureCode: row.failureCode,
    attemptCount: row.attemptCount,
    nextRetryAt: row.nextRetryAt,
    failureClassification: row.failureClassification,
    reconciliationStatus: row.reconciliationStatus,
    correlationId: row.correlationId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
