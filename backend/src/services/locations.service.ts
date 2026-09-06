import { prisma } from "../prisma.js";
import type { Prisma } from "@prisma/client";
import {
  EntitlementDeniedError,
  planLimitExceededPayload,
  resolveSubscriptionEntitlements,
  subscriptionRequiredPayload,
} from "./subscriptionEntitlement.service.js";
import { getPlanLimitForResource, isWithinPlanLimit } from "../config/subscriptionCapabilities.js";
import { lockPlanResourceQuota } from "../lib/planResourceQuotaLock.js";
import { emitBusinessDataChanged } from "../socket/socketEmitters.js";
import { invalidateBusinessStatsCache } from "./business.service.js";

export async function listLocationsForBusinessUser(userId: string) {
  const business = await prisma.business.findUnique({ where: { userId } });
  if (!business) {
    throw new Error("Business not found");
  }
  return prisma.location.findMany({
    where: { businessId: business.id },
    orderBy: { name: "asc" },
  });
}

export async function createLocationForBusinessUser(
  userId: string,
  name: string,
  description?: string | null
) {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Location name is required");
  }
  const business = await prisma.business.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!business) {
    throw new Error("Business not found");
  }
  const entitlements = await resolveSubscriptionEntitlements(business.id);
  if (!entitlements.hasActiveEntitlements) {
    throw new EntitlementDeniedError(403, subscriptionRequiredPayload("locationQr"));
  }
  const desc = description?.trim();
  const loc = await prisma.$transaction(async (tx) => {
    const limit = getPlanLimitForResource(entitlements.subscriptionTier, "locations");
    if (limit !== null) {
      await lockPlanResourceQuota(tx, "locations", business.id);
    }
    const count = await tx.location.count({ where: { businessId: business.id } });
    if (!isWithinPlanLimit(entitlements.subscriptionTier, "locations", count)) {
      throw new EntitlementDeniedError(
        403,
        planLimitExceededPayload("locations", entitlements.subscriptionTier),
      );
    }
    return tx.location.create({
      data: {
        name: trimmed,
        businessId: business.id,
        ...(desc ? { description: desc } : {}),
      },
    });
  }, { timeout: 15_000, maxWait: 10_000 });
  emitBusinessDataChanged(business.id, "location_created");
  invalidateBusinessStatsCache(business.id);
  return loc;
}

export async function assertLocationOwnedByBusiness(
  locationId: string,
  businessId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const loc = await db.location.findFirst({
    where: { id: locationId, businessId },
  });
  if (!loc) {
    throw new Error("Location not found");
  }
  return loc;
}

async function resolveBusinessIdForUser(userId: string): Promise<string> {
  const business = await prisma.business.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!business) {
    throw new Error("Business not found");
  }
  return business.id;
}

export async function updateLocationForBusinessUser(
  userId: string,
  locationId: string,
  name: string,
  description?: string | null,
) {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Location name is required");
  }
  const businessId = await resolveBusinessIdForUser(userId);
  await assertLocationOwnedByBusiness(locationId, businessId);
  const data: { name: string; description?: string | null } = { name: trimmed };
  if (typeof description === "string") {
    const desc = description.trim();
    data.description = desc.length > 0 ? desc : null;
  }
  const loc = await prisma.location.update({
    where: { id: locationId },
    data,
  });
  emitBusinessDataChanged(businessId, "location_updated");
  invalidateBusinessStatsCache(businessId);
  return loc;
}

export async function deleteLocationForBusinessUser(userId: string, locationId: string) {
  const businessId = await resolveBusinessIdForUser(userId);
  await assertLocationOwnedByBusiness(locationId, businessId);
  // Cascades venue tables; tip history / employees keep rows with locationId set null.
  await prisma.location.delete({ where: { id: locationId } });
  emitBusinessDataChanged(businessId, "location_deleted");
  invalidateBusinessStatsCache(businessId);
}
