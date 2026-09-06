import { Prisma } from "@prisma/client";
import type { PlanResourceLimit } from "../config/subscriptionCapabilities.js";

/**
 * Transaction-scoped PostgreSQL advisory lock (released at COMMIT/ROLLBACK).
 * Key is hashtextextended of a resource-scoped string so location and table
 * quotas do not share a lock, and unrelated businesses do not share a key
 * (birthday collisions only extra-serialize, never weaken a cap).
 */
export async function lockPlanResourceQuota(
  tx: Prisma.TransactionClient,
  resource: PlanResourceLimit,
  businessId: string,
): Promise<void> {
  await tx.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`caretip.quota.${resource}.${businessId}`}, 0))`,
  );
}
