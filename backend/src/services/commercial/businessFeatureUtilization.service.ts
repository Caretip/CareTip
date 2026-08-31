import { prisma } from "../../prisma.js";
import type { CommercialFeatureKey } from "./commercialFeatureKeys.js";
import { COMMERCIAL_FEATURE_KEYS, isCommercialFeatureKey } from "./commercialFeatureKeys.js";

export type FeatureUtilizationRow = {
  featureKey: CommercialFeatureKey;
  hits30d: number;
  lastUsedAt: string | null;
  source: "tracked" | "inferred";
};

function startOfUtcDay(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Record a feature page visit or server-side signal (Sprint 7B). */
export async function recordFeatureUtilization(
  businessId: string,
  featureKey: CommercialFeatureKey,
): Promise<void> {
  const day = startOfUtcDay();
  await prisma.featureUtilizationDaily.upsert({
    where: {
      businessId_featureKey_day: { businessId, featureKey, day },
    },
    create: { businessId, featureKey, day, hitCount: 1 },
    update: { hitCount: { increment: 1 }, lastUsedAt: new Date() },
  });
}

/** Batch record from client (debounced page tracking). */
export async function recordFeatureUtilizationBatch(
  businessId: string,
  keys: string[],
): Promise<void> {
  const unique = [...new Set(keys.filter(isCommercialFeatureKey))];
  if (unique.length === 0) return;

  const day = startOfUtcDay();
  const now = new Date();
  const existing = await prisma.featureUtilizationDaily.findMany({
    where: { businessId, day, featureKey: { in: unique } },
    select: { featureKey: true },
  });
  const existingKeys = new Set(existing.map((r) => r.featureKey));
  const toCreate = unique.filter((k) => !existingKeys.has(k));
  const toIncrement = unique.filter((k) => existingKeys.has(k));

  if (toCreate.length > 0) {
    await prisma.featureUtilizationDaily.createMany({
      data: toCreate.map((featureKey) => ({
        businessId,
        featureKey,
        day,
        hitCount: 1,
        lastUsedAt: now,
      })),
      skipDuplicates: true,
    });
  }

  if (toIncrement.length > 0) {
    await prisma.$transaction(
      toIncrement.map((featureKey) =>
        prisma.featureUtilizationDaily.update({
          where: {
            businessId_featureKey_day: { businessId, featureKey, day },
          },
          data: { hitCount: { increment: 1 }, lastUsedAt: now },
        }),
      ),
    );
  }
}

async function getTrackedUtilization(businessId: string, days = 30): Promise<Map<CommercialFeatureKey, FeatureUtilizationRow>> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);

  const rows = await prisma.featureUtilizationDaily.groupBy({
    by: ["featureKey"],
    where: { businessId, day: { gte: since } },
    _sum: { hitCount: true },
    _max: { lastUsedAt: true },
  });

  const map = new Map<CommercialFeatureKey, FeatureUtilizationRow>();
  for (const row of rows) {
    if (!isCommercialFeatureKey(row.featureKey)) continue;
    map.set(row.featureKey, {
      featureKey: row.featureKey,
      hits30d: row._sum.hitCount ?? 0,
      lastUsedAt: row._max.lastUsedAt?.toISOString() ?? null,
      source: "tracked",
    });
  }
  return map;
}

/** Infer utilization from durable DB state (no page tracking required). */
async function inferUtilizationFromData(businessId: string): Promise<Map<CommercialFeatureKey, FeatureUtilizationRow>> {
  const now = new Date().toISOString();
  const map = new Map<CommercialFeatureKey, FeatureUtilizationRow>();

  const [business, locationCount, tableCount, goalCount, qrScans30d] = await Promise.all([
    prisma.business.findUnique({
      where: { id: businessId },
      select: {
        bannerImagePath: true,
        brandDisplayName: true,
        brandTagline: true,
        qrTemplate: true,
        brandPrimaryColor: true,
        welcomeMessage: true,
        thankYouMessage: true,
      },
    }),
    prisma.location.count({ where: { businessId } }),
    prisma.table.count({ where: { location: { businessId } } }),
    prisma.employeeGoal.count({
      where: { employee: { businessId } },
    }),
    prisma.qrScanEvent.count({
      where: {
        businessId,
        scannedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
    }),
  ]);

  if (locationCount > 1) {
    map.set("multi_location", {
      featureKey: "multi_location",
      hits30d: locationCount,
      lastUsedAt: now,
      source: "inferred",
    });
  }

  if (tableCount > 0) {
    map.set("table_qr", {
      featureKey: "table_qr",
      hits30d: tableCount,
      lastUsedAt: now,
      source: "inferred",
    });
  }

  if (goalCount > 0) {
    map.set("employee_goals", {
      featureKey: "employee_goals",
      hits30d: goalCount,
      lastUsedAt: now,
      source: "inferred",
    });
  }

  if (qrScans30d > 0) {
    map.set("qr_analytics", {
      featureKey: "qr_analytics",
      hits30d: qrScans30d,
      lastUsedAt: now,
      source: "inferred",
    });
  }

  const hasBranding =
    Boolean(business?.bannerImagePath) ||
    Boolean(business?.brandDisplayName) ||
    Boolean(business?.brandTagline) ||
    Boolean(business?.welcomeMessage) ||
    Boolean(business?.thankYouMessage) ||
    (business?.qrTemplate && business.qrTemplate !== "velvet-lounge-noir");

  if (hasBranding) {
    map.set("branding", {
      featureKey: "branding",
      hits30d: 1,
      lastUsedAt: now,
      source: "inferred",
    });
    map.set("qr_studio", {
      featureKey: "qr_studio",
      hits30d: 1,
      lastUsedAt: now,
      source: "inferred",
    });
  }

  return map;
}

/** Merged utilization: tracked page visits + inferred DB signals. */
export async function getBusinessFeatureUtilization(
  businessId: string,
  days = 30,
): Promise<FeatureUtilizationRow[]> {
  const [tracked, inferred] = await Promise.all([
    getTrackedUtilization(businessId, days),
    inferUtilizationFromData(businessId),
  ]);

  const merged = new Map<CommercialFeatureKey, FeatureUtilizationRow>();

  for (const key of COMMERCIAL_FEATURE_KEYS) {
    const t = tracked.get(key);
    const i = inferred.get(key);
    if (!t && !i) continue;
    merged.set(key, {
      featureKey: key,
      hits30d: Math.max(t?.hits30d ?? 0, i?.hits30d ?? 0),
      lastUsedAt: t?.lastUsedAt ?? i?.lastUsedAt ?? null,
      source: t && i ? "tracked" : (t?.source ?? i?.source ?? "tracked"),
    });
  }

  return [...merged.values()].sort((a, b) => b.hits30d - a.hits30d);
}
