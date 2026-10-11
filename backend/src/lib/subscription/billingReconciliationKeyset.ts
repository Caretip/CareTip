import type { Prisma } from "@prisma/client";
import type { BillingReconciliationCursor } from "../../services/subscriptionBillingReconciliationCursor.service.js";

export type ReconciliationBusinessKey = {
  id: string;
  createdAt: Date;
};

export function compareReconciliationBusinessKeys(
  a: ReconciliationBusinessKey,
  b: ReconciliationBusinessKey,
): number {
  const byTime = a.createdAt.getTime() - b.createdAt.getTime();
  if (byTime !== 0) return byTime;
  return a.id.localeCompare(b.id);
}

export function buildEligibleBusinessesWhere(
  cursor: BillingReconciliationCursor | null,
): Prisma.BusinessWhereInput {
  const base: Prisma.BusinessWhereInput = {
    stripeCustomerId: { not: null },
  };
  if (!cursor) {
    return base;
  }
  return {
    ...base,
    OR: [
      { createdAt: { gt: cursor.anchorCreatedAt } },
      {
        createdAt: cursor.anchorCreatedAt,
        id: { gt: cursor.anchorBusinessId },
      },
    ],
  };
}

/**
 * Advance cursor to the last row in a full batch; reset (null) when the ring wrapped.
 */
export function resolveNextReconciliationCursor(
  batch: ReconciliationBusinessKey[],
  batchSize: number,
): BillingReconciliationCursor | null {
  if (batch.length === 0) {
    return null;
  }
  if (batch.length < batchSize) {
    return null;
  }
  const last = batch[batch.length - 1]!;
  return { anchorCreatedAt: last.createdAt, anchorBusinessId: last.id };
}
