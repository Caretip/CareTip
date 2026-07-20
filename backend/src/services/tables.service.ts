import { randomBytes } from "crypto";
import { prisma } from "../prisma.js";
import { isOnboardingApprovedForPublicGoLive } from "../lib/verificationWorkflow.js";
import {
  assertPlanLimitForBusiness,
  planLimitExceededPayload,
  resolveSubscriptionEntitlements,
} from "./subscriptionEntitlement.service.js";
import { emitBusinessDataChanged } from "../socket/socketEmitters.js";
import { invalidateBusinessStatsCache } from "./business.service.js";
import * as locationsService from "./locations.service.js";
import { absolutizePublicMediaPath } from "../utils/publicMediaUrl.js";

function generateQrSlug(): string {
  return `t-${randomBytes(8).toString("hex")}`;
}

export async function listTablesForBusinessUser(userId: string) {
  const business = await prisma.business.findUnique({ where: { userId } });
  if (!business) {
    throw new Error("Business not found");
  }
  return prisma.table.findMany({
    where: { location: { businessId: business.id } },
    include: {
      location: { select: { id: true, name: true } },
    },
    orderBy: [{ location: { name: "asc" } }, { name: "asc" }],
  });
}

export async function createTableForBusinessUser(
  userId: string,
  input: { name: string; locationId: string; qrSlug?: string }
) {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Table name is required");
  }
  const business = await prisma.business.findUnique({ where: { userId } });
  if (!business) {
    throw new Error("Business not found");
  }
  const entitlements = await resolveSubscriptionEntitlements(business.id);
  if (!entitlements.hasActiveEntitlements) {
    throw new Error("An active subscription is required to manage tables.");
  }
  if (!entitlements.capabilities.includes("tableQr")) {
    throw new Error("Table QR is not available on your current plan.");
  }
  const tableCount = await prisma.table.count({
    where: { location: { businessId: business.id } },
  });
  const limitCheck = await assertPlanLimitForBusiness(business.id, "tables", tableCount);
  if (!limitCheck.ok) {
    const payload = planLimitExceededPayload("tables", limitCheck.tier);
    throw new Error(payload.message);
  }
  await locationsService.assertLocationOwnedByBusiness(input.locationId, business.id);

  let qrSlug = input.qrSlug?.trim();
  if (qrSlug) {
    if (!/^[a-zA-Z0-9_-]{3,128}$/.test(qrSlug)) {
      throw new Error("qrSlug must be 3–128 characters: letters, numbers, hyphens, underscores");
    }
    const taken = await prisma.table.findUnique({ where: { qrSlug } });
    if (taken) {
      throw new Error("This QR slug is already in use");
    }
  } else {
    for (let i = 0; i < 5; i++) {
      const candidate = generateQrSlug();
      const exists = await prisma.table.findUnique({ where: { qrSlug: candidate } });
      if (!exists) {
        qrSlug = candidate;
        break;
      }
    }
    if (!qrSlug) {
      throw new Error("Could not generate a unique QR slug");
    }
  }

  const table = await prisma.table.create({
    data: {
      name,
      locationId: input.locationId,
      qrSlug,
    },
  });
  emitBusinessDataChanged(business.id, "table_created");
  invalidateBusinessStatsCache(business.id);
  return table;
}

export async function getTippingContextByQrSlug(qrSlug: string) {
  let decoded: string;
  try {
    decoded = decodeURIComponent(qrSlug).trim();
  } catch {
    return null;
  }
  if (!decoded) {
    return null;
  }

  // Defensive validation: keep public slug lookups bounded and predictable.
  if (!/^[a-zA-Z0-9_-]{3,128}$/.test(decoded)) {
    return null;
  }
  const table = await prisma.table.findUnique({
    where: { qrSlug: decoded },
    select: {
      id: true,
      name: true,
      locationId: true,
      location: {
        select: {
          name: true,
          businessId: true,
          business: { select: { id: true, name: true, onboardingVerificationStatus: true, logoPath: true } },
        },
      },
    },
  });
  if (!table) {
    return null;
  }
  if (!isOnboardingApprovedForPublicGoLive(table.location.business.onboardingVerificationStatus)) {
    return { locked: true as const };
  }
  return {
    locationName: table.location.name,
    tableName: table.name,
    businessId: table.location.businessId,
    locationId: table.locationId,
    tableId: table.id,
    businessName: table.location.business.name,
    businessLogo: absolutizePublicMediaPath(table.location.business.logoPath ?? null),
  };
}
