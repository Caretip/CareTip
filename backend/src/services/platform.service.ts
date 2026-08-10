import Stripe from "stripe";
import { Prisma, Role } from "@prisma/client";
import { prisma } from "../prisma.js";
import {
  emitBusinessDataChanged,
  emitPlatformDataUpdated,
  emitVerificationUpdated,
} from "../socket/socketEmitters.js";
import { CARETIP_FEE_PERCENT } from "../config/fees.js";
import { impersonationAuthUserDto, signImpersonationToken } from "./auth.service.js";
import {
  getCachedOrLoad,
  invalidateCacheKey,
  invalidateCacheKeyPrefix,
} from "../utils/shortLivedCache.js";
import { parseKycDocuments, type KycDocuments } from "./kyc.service.js";
import { sanitizeLikeContainsSearch } from "../utils/likeSearch.js";
import { updateSubscriptionMirrorPlanTransactional } from "./subscription.service.js";

const KYC_SLA_HOURS = 48;

export type KycReviewHistoryEntry = {
  status: "pending" | "verified" | "rejected";
  at: string;
  note?: string | null;
};

function parseKycReviewHistory(raw: unknown): KycReviewHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is KycReviewHistoryEntry => {
      if (!x || typeof x !== "object") return false;
      const o = x as Record<string, unknown>;
      return (
        (o.status === "pending" || o.status === "verified" || o.status === "rejected") &&
        typeof o.at === "string"
      );
    })
    .map((x) => ({
      status: x.status,
      at: x.at,
      note: typeof x.note === "string" ? x.note : null,
    }));
}

export function kycHoursPending(submittedAt: Date | null): number | null {
  if (!submittedAt) return null;
  return (Date.now() - submittedAt.getTime()) / (1000 * 60 * 60);
}

export function isKycSlaBreached(submittedAt: Date | null, kycOrLegacyStatus: string): boolean {
  const pending =
    kycOrLegacyStatus === "pending_review" || kycOrLegacyStatus === "pending";
  if (!pending) return false;
  const hours = kycHoursPending(submittedAt);
  return hours != null && hours > KYC_SLA_HOURS;
}

const PLATFORM_STATS_CACHE_TTL_MS = 45_000;
const PLATFORM_BUSINESSES_CACHE_TTL_MS = 45_000;

/** Invalidate platform admin dashboard caches (stats, businesses list). */
export function invalidatePlatformDashboardCache(): void {
  invalidateCacheKeyPrefix("platform:");
}

/** Invalidate fast-moving platform admin caches after tips (stats, charts, per-business tip totals). */
export function invalidatePlatformMetricsCache(): void {
  invalidateCacheKey("platform:stats");
  invalidateCacheKey("platform:businesses");
  invalidateCacheKeyPrefix("platform:analytics:");
}

export async function checkDatabaseHealth(): Promise<"online" | "offline"> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return "online";
  } catch {
    return "offline";
  }
}

export async function checkStripeHealth(): Promise<"online" | "offline"> {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) return "offline";
  try {
    const stripe = new Stripe(key);
    await stripe.balance.retrieve();
    return "online";
  } catch {
    return "offline";
  }
}

type PlatformTxAggRow = {
  transaction_count: bigint;
  success_count: bigint;
  total_volume: number | null;
  businesses_with_success: bigint;
};

/** Aggregates for SuperAdmin dashboard (EUR = tip amounts stored in DB). */
async function getGlobalPlatformStatsImpl() {
  const [txAggRows, businessesCount, employeesCount, locationsCount, usersActive] =
    await Promise.all([
      prisma.$queryRaw<PlatformTxAggRow[]>(Prisma.sql`
        SELECT
          COUNT(*)::bigint AS transaction_count,
          COUNT(*) FILTER (WHERE status = 'success')::bigint AS success_count,
          COALESCE(SUM(amount) FILTER (WHERE status = 'success'), 0)::float AS total_volume,
          COUNT(DISTINCT business_id) FILTER (WHERE status = 'success')::bigint AS businesses_with_success
        FROM tips
      `),
      prisma.business.count(),
      prisma.employee.count(),
      prisma.location.count(),
      prisma.user.count({ where: { isActive: true } }),
    ]);

  const txAgg = txAggRows[0];
  const transactionCount = Number(txAgg?.transaction_count ?? 0);
  const successCount = Number(txAgg?.success_count ?? 0);
  const totalVolumeEur = Number(txAgg?.total_volume ?? 0);
  const businessesWithSuccessfulTips = Number(txAgg?.businesses_with_success ?? 0);

  return {
    totalVolumeEur,
    totalVolumeEurFormatted: totalVolumeEur.toLocaleString("de-DE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
    transactionCount,
    successTransactionCount: successCount,
    businessesCount,
    employeesCount,
    locationsCount,
    activeUsersCount: usersActive,
    businessesWithSuccessfulTips,
    platformTotalTipsFromBusinessRollupEur: totalVolumeEur,
    platformTotalsConsistent: true,
  };
}

export async function getGlobalPlatformStats() {
  return getCachedOrLoad("platform:stats", PLATFORM_STATS_CACHE_TTL_MS, getGlobalPlatformStatsImpl);
}

export async function listGlobalTransactions(params: {
  q?: string;
  take: number;
  skip: number;
}) {
  const where: Prisma.TransactionWhereInput = {};
  const q = sanitizeLikeContainsSearch(params.q);
  if (q) {
    where.OR = [
      { id: { contains: q, mode: "insensitive" } },
      { stripePaymentIntentId: { contains: q, mode: "insensitive" } },
      { business: { name: { contains: q, mode: "insensitive" } } },
      { employee: { name: { contains: q, mode: "insensitive" } } },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: params.take,
      skip: params.skip,
      include: {
        business: { select: { id: true, name: true } },
        employee: { select: { id: true, name: true } },
      },
    }),
    prisma.transaction.count({ where }),
  ]);

  const feeRate = CARETIP_FEE_PERCENT / 100;
  const items = rows.map((t) => {
    const gross = Number(t.amount);
    const feeAmount = Math.round(gross * feeRate * 100) / 100;
    const netToStaff = Math.round((gross - feeAmount) * 100) / 100;
    return {
      id: t.id,
      amountEur: gross,
      caretipFeePercent: CARETIP_FEE_PERCENT,
      caretipFeeEur: feeAmount,
      netToStaffEur: netToStaff,
      payoutStatus: t.payoutStatus,
      tipStatus: t.status,
      stripePaymentIntentId: t.stripePaymentIntentId,
      createdAt: t.createdAt.toISOString(),
      businessId: t.businessId,
      businessName: t.business.name,
      employeeName: t.employee?.name ?? "Former team member",
      employeeId: t.employeeId,
    };
  });

  return { items, total };
}

export async function getKycQueueMetrics() {
  const { getKycQueueMetrics: countKycMetrics } = await import("./platformBusinessList.service.js");
  return countKycMetrics();
}

export async function getAllBusinessActivity() {
  return getCachedOrLoad(
    "platform:businesses",
    PLATFORM_BUSINESSES_CACHE_TTL_MS,
    async () => {
      const { listPlatformBusinesses } = await import("./platformBusinessList.service.js");
      const { items } = await listPlatformBusinesses({
        take: 10_000,
        skip: 0,
        sort: "tips_high",
      });
      return items;
    },
  );
}

/** @deprecated use getAllBusinessActivity */
export async function listBusinessesForAdmin() {
  return getAllBusinessActivity();
}

export async function updateBusinessVerificationStatus(
  businessId: string,
  status: "pending" | "verified" | "rejected",
  opts?: { reviewNote?: string | null; adminUserId?: string },
) {
  const { updateKycVerificationStatus } = await import("./businessVerificationWorkflow.service.js");
  const action =
    status === "verified" ? "verified" : status === "rejected" ? "rejected" : "pending_review";
  await updateKycVerificationStatus(businessId, action, opts);
}

/** @deprecated prefer updateBusinessVerificationStatus */
export async function verifyBusiness(businessId: string) {
  await updateBusinessVerificationStatus(businessId, "verified");
}

export async function getBusinessForAdmin(businessId: string) {
  const [b, tipSum, successTipCount] = await Promise.all([
    prisma.business.findUnique({
      where: { id: businessId },
      include: {
        user: { select: { id: true, email: true, isActive: true } },
        _count: { select: { employees: true, locations: true } },
      },
    }),
    prisma.transaction.aggregate({
      where: { businessId, status: "success" },
      _sum: { amount: true },
    }),
    prisma.transaction.count({ where: { businessId, status: "success" } }),
  ]);
  if (!b) return null;
  if (b.deletedAt) return null;
  return {
    id: b.id,
    name: b.name,
    slug: b.slug,
    verificationStatus: b.verificationStatus,
    onboardingVerificationStatus: b.onboardingVerificationStatus,
    kycVerificationStatus: b.kycVerificationStatus,
    operationalStatus: b.operationalStatus,
    ownerIsActive: b.user.isActive,
    onboardingSubmittedAt: b.onboardingSubmittedAt?.toISOString() ?? null,
    onboardingReviewNotes: b.onboardingReviewNotes,
    onboardingReviewHistory: parseKycReviewHistory(b.onboardingReviewHistory),
    legalContactName: b.legalContactName,
    contactEmail: b.contactEmail,
    contactPhone: b.contactPhone,
    website: (b as any).website ?? null,
    registeredAddress: b.registeredAddress,
    ownerUserId: b.user.id,
    ownerEmail: b.user.email,
    staffCount: b._count.employees,
    locationCount: b._count.locations,
    logoPath: b.logoPath,
    verificationDocumentPath: b.verificationDocumentPath,
    kycDocuments: parseKycDocuments(b.kycDocuments),
    kycSubmittedAt: b.kycSubmittedAt?.toISOString() ?? null,
    kycReviewNotes: b.kycReviewNotes,
    kycReviewHistory: parseKycReviewHistory(b.kycReviewHistory),
    kycHoursPending: kycHoursPending(b.kycSubmittedAt),
    kycSlaBreached: isKycSlaBreached(b.kycSubmittedAt, b.kycVerificationStatus),
    totalTipsEur: Number(tipSum._sum.amount ?? 0),
    successTipCount,
    subscriptionTier: b.subscriptionTier,
  };
}

export async function updateBusinessKycReviewNotes(businessId: string, notes: string | null) {
  await prisma.business.update({
    where: { id: businessId },
    data: { kycReviewNotes: notes?.trim() || null },
  });
  invalidatePlatformDashboardCache();
  emitPlatformDataUpdated("kyc_review_notes");
  const refreshed = await getBusinessForAdmin(businessId);
  if (!refreshed) throw new Error("Business not found");
  return refreshed;
}

export async function updateBusinessSubscriptionTier(
  businessId: string,
  tier: "basic" | "premium" | "enterprise",
  actorUserId: string,
) {
  const existing = await prisma.business.findUnique({
    where: { id: businessId },
    select: { subscriptionTier: true },
  });
  if (!existing) {
    throw new Error("Business not found");
  }

  if (existing.subscriptionTier !== tier) {
    await updateSubscriptionMirrorPlanTransactional({
      businessId,
      newTier: tier,
      previousTier: existing.subscriptionTier,
      actorUserId,
    });
  }

  const refreshed = await getBusinessForAdmin(businessId);
  if (!refreshed) throw new Error("Business not found");
  emitBusinessDataChanged(businessId, "subscription_tier_updated");
  invalidatePlatformDashboardCache();
  emitPlatformDataUpdated("subscription_tier");
  return refreshed;
}

export async function listAuditLogsForAdmin(params: { take: number; skip: number }) {
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: params.take,
      skip: params.skip,
      include: { user: { select: { email: true } } },
    }),
    prisma.auditLog.count(),
  ]);
  return {
    items: rows.map((r) => ({
      id: r.id,
      action: r.action,
      userId: r.userId,
      userEmail: r.user?.email ?? null,
      metadata: r.metadata,
      createdAt: r.createdAt.toISOString(),
    })),
    total,
  };
}

export async function updateBusinessKyc(
  businessId: string,
  data: {
    legalContactName?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
    website?: string | null;
    registeredAddress?: string | null;
  }
) {
  await prisma.business.update({
    where: { id: businessId },
    data: {
      ...(data.legalContactName !== undefined && { legalContactName: data.legalContactName }),
      ...(data.contactEmail !== undefined && { contactEmail: data.contactEmail }),
      ...(data.contactPhone !== undefined && { contactPhone: data.contactPhone }),
      ...(data.website !== undefined && { website: data.website }),
      ...(data.registeredAddress !== undefined && { registeredAddress: data.registeredAddress }),
    },
  });
  const refreshed = await getBusinessForAdmin(businessId);
  if (!refreshed) throw new Error("Business not found");
  emitBusinessDataChanged(businessId, "kyc_updated");
  invalidatePlatformDashboardCache();
  emitPlatformDataUpdated("kyc_updated");
  return refreshed;
}

export async function setBusinessLogoPath(businessId: string, publicPath: string) {
  await prisma.business.update({
    where: { id: businessId },
    data: { logoPath: publicPath },
  });
  emitBusinessDataChanged(businessId, "logo_updated");
  invalidatePlatformDashboardCache();
  emitPlatformDataUpdated("business_logo");
}

export async function setBusinessVerificationDocumentPath(businessId: string, publicPath: string) {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { name: true },
  });
  await prisma.business.update({
    where: { id: businessId },
    data: { verificationDocumentPath: publicPath },
  });
  emitBusinessDataChanged(businessId, "verification_doc_updated");
  invalidatePlatformDashboardCache();
  emitPlatformDataUpdated("verification_document");
  if (business?.name) {
    const { onBusinessVerificationDocumentUploaded } = await import(
      "./push/notification.triggers.js"
    );
    onBusinessVerificationDocumentUploaded(businessId, business.name);
  }
}

export type PlatformAnnouncementAudience = "all" | "managers" | "employees" | "admins";

export async function resolveAnnouncementRecipientIds(
  audience: PlatformAnnouncementAudience,
): Promise<string[]> {
  const where: Prisma.UserWhereInput = { isActive: true };
  if (audience === "managers") {
    where.role = Role.MANAGER;
  } else if (audience === "employees") {
    where.role = Role.EMPLOYEE;
  } else if (audience === "admins") {
    where.role = Role.SUPER_ADMIN;
  } else {
    where.role = { in: [Role.MANAGER, Role.EMPLOYEE] };
  }
  const rows = await prisma.user.findMany({
    where,
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export type AnnouncementChannelInput = {
  inApp?: boolean;
  push?: boolean;
  email?: boolean;
};

/** Broadcast to managers and/or employees — inbox, push, optional email. */
export async function sendPlatformAnnouncement(input: {
  title: string;
  body: string;
  url?: string;
  audience: PlatformAnnouncementAudience;
  announcementId?: string;
  createdById: string;
  priority?: "normal" | "high";
  channels?: AnnouncementChannelInput;
}): Promise<{ recipientCount: number; announcementId: string }> {
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title || !body) {
    throw new Error("title and body are required");
  }

  const channelList: string[] = [];
  const ch = input.channels ?? { inApp: true, push: true, email: false };
  if (ch.inApp !== false) channelList.push("in_app");
  if (ch.push !== false) channelList.push("push");
  if (ch.email === true) channelList.push("email");
  if (channelList.length === 0) channelList.push("in_app");

  const userIds = await resolveAnnouncementRecipientIds(input.audience);
  const announcement = await prisma.announcement.create({
    data: {
      createdById: input.createdById,
      title,
      message: body,
      audience: input.audience,
      priority: input.priority ?? "normal",
      channels: channelList,
      url: input.url?.trim() || null,
      recipientCount: userIds.length,
    },
  });

  const { deliverNotificationToUsers } = await import(
    "./notifications/notificationOrchestrator.service.js"
  );
  const { NotificationType } = await import("./push/notification.types.js");

  void deliverNotificationToUsers(
    userIds,
    {
      type: NotificationType.ADMIN_ANNOUNCEMENT,
      title,
      body,
      url: input.url?.trim() || undefined,
      timestamp: new Date().toISOString(),
      metadata: { entityId: announcement.id, announcementId: announcement.id },
    },
    {
      dedupeKeyPrefix: `admin:${announcement.id}`,
      priority: input.priority ?? "normal",
      channels: {
        in_app: channelList.includes("in_app"),
        push: channelList.includes("push"),
        email: channelList.includes("email"),
      },
    },
  );

  return { recipientCount: userIds.length, announcementId: announcement.id };
}

export async function listAnnouncementsForAdmin(params: { take: number; skip: number }) {
  const [rows, total] = await Promise.all([
    prisma.announcement.findMany({
      orderBy: { createdAt: "desc" },
      take: params.take,
      skip: params.skip,
      include: {
        createdBy: { select: { email: true } },
      },
    }),
    prisma.announcement.count(),
  ]);
  return {
    items: rows.map((r) => ({
      id: r.id,
      title: r.title,
      message: r.message,
      audience: r.audience,
      priority: r.priority,
      channels: r.channels,
      url: r.url,
      recipientCount: r.recipientCount,
      createdByEmail: r.createdBy?.email ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
    total,
  };
}

export async function impersonateBusinessManager(
  platformAdminUserId: string,
  businessId: string
) {
  const admin = await prisma.user.findUnique({ where: { id: platformAdminUserId } });
  if (!admin || admin.role !== "SUPER_ADMIN" || !admin.isPlatformAdmin) {
    throw new Error("Forbidden");
  }

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    include: { user: true },
  });
  if (!business) {
    throw new Error("Business not found");
  }

  const token = signImpersonationToken(business.userId, business.user.email, platformAdminUserId);

  return {
    token,
    user: impersonationAuthUserDto(business.user, business, platformAdminUserId),
  };
}
