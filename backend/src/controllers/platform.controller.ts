import type { Request, Response } from "express";
import * as platformService from "../services/platform.service.js";
import * as businessService from "../services/business.service.js";
import { prisma } from "../prisma.js";
import * as platformAnalyticsService from "../services/platformAnalytics.service.js";
import {
  uploadPlatformBusinessLogoImage,
  uploadPlatformVerificationDocument,
  removeStoredUploadReferenceIfPossible,
} from "../services/upload.service.js";
import {
  logServerError,
  clientSafeMessage,
} from "../utils/httpErrors.js";
import { removeUploadedObjectByPublicUrlIfPossible } from "../lib/supabaseStorageClient.js";
import { sanitizeIanaTimezone, DEFAULT_BUSINESS_TIMEZONE } from "../utils/businessTime.js";
import { DateTime } from "luxon";
import { isPrismaPoolTimeout } from "../utils/prismaErrors.js";
import {
  SPONSORED_CAPABILITY_PROFILE_KEYS,
  SPONSORED_PROGRAMMES,
  isSponsoredCapabilityProfileKey,
  isSponsoredProgrammeKey,
  type SponsoredCapabilityProfileKey,
  type SponsoredProgrammeKey,
} from "../config/sponsoredAccess.config.js";
import {
  activateSponsoredAccessGrant,
  createSponsoredAccessGrant,
  listSponsoredGrantsForBusiness,
  revokeSponsoredAccessGrant,
  updateSponsoredAccessGrant,
} from "../services/sponsoredAccess.service.js";

export async function getOnboardingQueueMetrics(_req: Request, res: Response) {
  try {
    const { getOnboardingQueueMetrics, getFullyVerifiedBusinessCount } = await import(
      "../services/platformBusinessList.service.js"
    );
    const [metrics, fullyVerified] = await Promise.all([
      getOnboardingQueueMetrics(),
      getFullyVerifiedBusinessCount(),
    ]);
    return res.json({ ...metrics, fullyVerified });
  } catch (err) {
    logServerError("platform.getOnboardingQueueMetrics", err);
    return res.status(500).json({
      message: clientSafeMessage(err, "We couldn't load onboarding queue metrics."),
    });
  }
}

export async function verifyBusinessOnboarding(req: Request, res: Response) {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ message: "id is required" });
    const body = req.body as { status?: string; reviewNote?: string } | undefined;
    const raw = body?.status;
    const action =
      raw === "rejected" || raw === "approved" || raw === "submitted"
        ? raw
        : "approved";
    const { updateOnboardingVerificationStatus } = await import(
      "../services/businessVerificationWorkflow.service.js"
    );
    await updateOnboardingVerificationStatus(id, action, {
      reviewNote: body?.reviewNote,
      adminUserId: req.user?.userId ?? req.user?.id,
    });
    return res.json({ success: true });
  } catch (err) {
    logServerError("platform.verifyBusinessOnboarding", err);
    return res.status(400).json({
      message: clientSafeMessage(err, "We couldn't update onboarding verification."),
    });
  }
}

export async function verifyBusinessKyc(req: Request, res: Response) {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ message: "id is required" });
    const body = req.body as { status?: string; reviewNote?: string } | undefined;
    const raw = body?.status;
    const action =
      raw === "rejected" || raw === "verified" || raw === "pending" || raw === "pending_review"
        ? raw === "pending"
          ? "pending_review"
          : raw === "verified"
            ? "verified"
            : raw
        : "verified";
    const { updateKycVerificationStatus } = await import(
      "../services/businessVerificationWorkflow.service.js"
    );
    await updateKycVerificationStatus(id, action as "verified" | "rejected" | "pending_review", {
      reviewNote: body?.reviewNote,
    });
    return res.json({ success: true });
  } catch (err) {
    logServerError("platform.verifyBusinessKyc", err);
    return res.status(400).json({
      message: clientSafeMessage(err, "We couldn't update KYC verification."),
    });
  }
}

export async function getKycQueueMetrics(_req: Request, res: Response) {
  try {
    const metrics = await platformService.getKycQueueMetrics();
    return res.json(metrics);
  } catch (err) {
    logServerError("platform.getKycQueueMetrics", err);
    return res.status(500).json({
      message: clientSafeMessage(err, "We couldn't load KYC queue metrics."),
    });
  }
}

export async function patchBusinessKycReviewNotes(req: Request, res: Response) {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ message: "id is required" });
    const notes =
      typeof req.body?.notes === "string" ? req.body.notes : req.body?.notes === null ? null : undefined;
    if (notes === undefined) {
      return res.status(400).json({ message: "notes is required" });
    }
    const business = await platformService.updateBusinessKycReviewNotes(id, notes);
    return res.json({ success: true, business });
  } catch (err) {
    logServerError("platform.patchBusinessKycReviewNotes", err);
    return res.status(400).json({
      message: clientSafeMessage(err, "We couldn't save review notes."),
    });
  }
}

export async function getHealth(_req: Request, res: Response) {
  try {
    const [database, stripe] = await Promise.all([
      platformService.checkDatabaseHealth(),
      platformService.checkStripeHealth(),
    ]);
    return res.json({
      database,
      stripe,
    });
  } catch (err) {
    logServerError("platform.getHealth", err);
    return res.status(503).json({
      message: clientSafeMessage(err, "We couldn't verify payment setup. Please try again."),
    });
  }
}

export async function listTransactions(req: Request, res: Response) {
  try {
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    const take = Math.min(Math.max(Number(req.query.take) || 50, 1), 100);
    const skip = Math.max(Number(req.query.skip) || 0, 0);
    const result = await platformService.listGlobalTransactions({ q, take, skip });
    return res.json(result);
  } catch (err) {
    logServerError("platform.listTransactions", err);
    return res.status(500).json({
      message: clientSafeMessage(err, "We couldn't load global transactions. Try again."),
    });
  }
}

export async function listRefunds(req: Request, res: Response) {
  try {
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    const kind = typeof req.query.kind === "string" ? req.query.kind : undefined;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const take = Math.min(Math.max(Number(req.query.take) || 50, 1), 100);
    const skip = Math.max(Number(req.query.skip) || 0, 0);
    const { listTipRefunds } = await import("../services/finance/tipRefunds.service.js");
    const result = await listTipRefunds({ q, take, skip, kind, status });
    return res.json(result);
  } catch (err) {
    logServerError("platform.listRefunds", err);
    return res.status(500).json({
      ledgerAvailable: false,
      total: 0,
      items: [],
      message: clientSafeMessage(err, "No refund data available"),
    });
  }
}

export async function exportRefunds(req: Request, res: Response) {
  try {
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    const kind = typeof req.query.kind === "string" ? req.query.kind : undefined;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const { exportTipRefundsCsv } = await import("../services/finance/tipRefunds.service.js");
    const csv = await exportTipRefundsCsv({ q, kind, status });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="caretip-refunds-ledger.csv"');
    return res.status(200).send(csv);
  } catch (err) {
    logServerError("platform.exportRefunds", err);
    return res.status(500).json({
      message: clientSafeMessage(err, "No refund data available"),
    });
  }
}

export async function getStats(_req: Request, res: Response) {
  try {
    const stats = await platformService.getGlobalPlatformStats();
    return res.json(stats);
  } catch (err) {
    logServerError("platform.getStats", err);
    // Never crash the platform admin dashboard on aggregation errors.
    // Return safe defaults so the UI can still render (and surface a FixPrompt).
    return res.json({
      totalVolumeEur: 0,
      totalVolumeEurFormatted: "0.00",
      transactionCount: 0,
      successTransactionCount: 0,
      businessesCount: 0,
      employeesCount: 0,
      locationsCount: 0,
      activeUsersCount: 0,
      businessesWithSuccessfulTips: 0,
      platformTotalTipsFromBusinessRollupEur: 0,
      platformTotalsConsistent: false,
      warning: clientSafeMessage(err, "We couldn't load platform statistics. Try again."),
    });
  }
}

export async function getAnalytics(req: Request, res: Response) {
  try {
    const days = req.query.days;
    const timezone =
      typeof req.query.timezone === "string"
        ? sanitizeIanaTimezone(req.query.timezone)
        : DEFAULT_BUSINESS_TIMEZONE;
    const data = await platformAnalyticsService.getPlatformAnalytics({ days, timezone });
    return res.json(data);
  } catch (err) {
    logServerError("platform.getAnalytics", err);
    if (isPrismaPoolTimeout(err)) {
      return res.status(503).json({
        message: "The server is busy. Please try again in a moment.",
      });
    }
    // Safe empty analytics payload: charts must not break the admin dashboard.
    const rawDays = typeof req.query.days === "string" ? Number(req.query.days) : 30;
    const rangeDays = Number.isFinite(rawDays) ? Math.min(Math.max(Math.floor(rawDays), 7), 120) : 30;
    const timezone =
      typeof req.query.timezone === "string"
        ? sanitizeIanaTimezone(req.query.timezone)
        : DEFAULT_BUSINESS_TIMEZONE;
    const localEnd = DateTime.now().setZone(timezone).startOf("day");
    const localStart = localEnd.minus({ days: rangeDays - 1 });
    const growth: Array<{ date: string; newUsers: number; newBusinesses: number; newTips: number }> = [];
    const tipVolume: Array<{ date: string; tipsEur: number; tipCount: number }> = [];
    for (let i = 0; i < rangeDays; i += 1) {
      const iso = localStart.plus({ days: i }).toFormat("yyyy-MM-dd");
      growth.push({ date: iso, newUsers: 0, newBusinesses: 0, newTips: 0 });
      tipVolume.push({ date: iso, tipsEur: 0, tipCount: 0 });
    }
    return res.json({
      timezone,
      rangeDays,
      userDistribution: [
        { role: "business", count: 0 },
        { role: "employee", count: 0 },
        { role: "platform_admin", count: 0 },
      ],
      tipStatus: [
        { status: "success", count: 0 },
        { status: "pending", count: 0 },
        { status: "failed", count: 0 },
      ],
      growth,
      tipVolume,
      topBusinessesByTips: [],
      warning: clientSafeMessage(err, "We couldn't load analytics right now. Try again."),
    });
  }
}

/** SuperAdmin: all businesses with live KYC fields, tip totals, and staff/location counts. */
export async function listBusinesses(req: Request, res: Response) {
  const query = req.query as Record<string, unknown>;
  const {
    hasBusinessListQueryParams,
    listPlatformBusinesses,
    parseBusinessListQuery,
  } = await import("../services/platformBusinessList.service.js");

  if (hasBusinessListQueryParams(query)) {
    try {
      const params = parseBusinessListQuery(query);
      const result = await listPlatformBusinesses(params);
      return res.json({ businesses: result.items, total: result.total });
    } catch (err) {
      logServerError("platform.listBusinesses.filtered", err);
      return res.status(500).json({
        message: clientSafeMessage(err, "We couldn't load the business list. Try again."),
      });
    }
  }

  try {
    const businesses = await platformService.getAllBusinessActivity();
    return res.json({ businesses });
  } catch (err) {
    logServerError("platform.listBusinesses", err);
    // Safe empty list: keep dashboard usable even when DB/schema is out of sync.
    return res.json({
      businesses: [],
      warning: clientSafeMessage(err, "We couldn't load the business list. Try again."),
    });
  }
}

export async function uploadBusinessLogo(req: Request, res: Response) {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ message: "id is required" });
    const file = req.file;
    if (!file?.buffer) {
      return res.status(400).json({ message: "File is required (multipart field name: file)" });
    }
    const existing = await prisma.business.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ message: "Business not found" });
    }
    const pathToStore = await uploadPlatformBusinessLogoImage(file.buffer, file.mimetype, id);
    try {
      await platformService.setBusinessLogoPath(id, pathToStore);
    } catch (dbErr) {
      await removeUploadedObjectByPublicUrlIfPossible(pathToStore);
      throw dbErr;
    }
    return res.json({ success: true, path: pathToStore });
  } catch (err) {
    logServerError("platform.uploadBusinessLogo", err);
    return res.status(500).json({
      message: clientSafeMessage(err, "We couldn't upload the logo. Try again."),
    });
  }
}

export async function uploadVerificationDocument(req: Request, res: Response) {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ message: "id is required" });
    const file = req.file;
    if (!file?.buffer) {
      return res.status(400).json({ message: "File is required (multipart field name: file)" });
    }
    const existing = await prisma.business.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ message: "Business not found" });
    }
    const pathToStore = await uploadPlatformVerificationDocument(file.buffer, file.mimetype, id);
    try {
      await platformService.setBusinessVerificationDocumentPath(id, pathToStore);
    } catch (dbErr) {
      await removeStoredUploadReferenceIfPossible(pathToStore);
      throw dbErr;
    }
    return res.json({ success: true, path: pathToStore });
  } catch (err) {
    logServerError("platform.uploadVerificationDocument", err);
    return res.status(500).json({
      message: clientSafeMessage(err, "We couldn't upload the verification document. Try again."),
    });
  }
}

export async function verifyBusiness(req: Request, res: Response) {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ message: "id is required" });
    const body = req.body as { status?: string; reviewNote?: string } | undefined;
    const raw = body?.status;
    const status =
      raw === "rejected" || raw === "pending" || raw === "verified" ? raw : "verified";
    const adminUserId = req.user?.userId ?? req.user?.id;
    await platformService.updateBusinessVerificationStatus(id, status, {
      reviewNote: body?.reviewNote,
      adminUserId,
    });
    return res.json({ success: true });
  } catch (err) {
    logServerError("platform.verifyBusiness", err);
    return res.status(400).json({
      message: clientSafeMessage(err, "We couldn't update verification status. Try again."),
    });
  }
}

export async function getBusiness(req: Request, res: Response) {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ message: "id is required" });
    const b = await platformService.getBusinessForAdmin(id);
    if (!b) return res.status(404).json({ message: "Business not found" });
    return res.json({ business: b });
  } catch (err) {
    logServerError("platform.getBusiness", err);
    return res.status(500).json({
      message: clientSafeMessage(err, "We couldn't load that business. Try again."),
    });
  }
}

/** SuperAdmin: removes the business graph and all manager/staff `User` rows for that venue. */
export async function deleteBusiness(req: Request, res: Response) {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ message: "id is required" });
    await businessService.deleteBusinessCascadeUsers(id);
    return res.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg === "Business not found") {
      return res.status(404).json({ message: msg });
    }
    if (
      msg.startsWith("Cannot delete") ||
      msg.includes("unexpected role") ||
      msg.includes("delete aborted")
    ) {
      return res.status(400).json({ message: msg });
    }
    logServerError("platform.deleteBusiness", err);
    return res.status(500).json({
      message: clientSafeMessage(err, "We couldn't delete that business. Try again."),
    });
  }
}

/** Soft-delete draft/rejected onboarding requests with no production data. */
export async function softDeleteBusiness(req: Request, res: Response) {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ message: "id is required" });
    const body = req.body as { reason?: string } | undefined;
    const { softDeleteBusinessForAdmin } = await import(
      "../services/businessOperationalLifecycle.service.js"
    );
    await softDeleteBusinessForAdmin(id, {
      reason: body?.reason,
      adminUserId: req.user?.userId ?? req.user?.id,
    });
    return res.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg === "Business not found") {
      return res.status(404).json({ message: msg });
    }
    if (msg.startsWith("Cannot") || msg.startsWith("Only")) {
      return res.status(400).json({ message: msg });
    }
    logServerError("platform.softDeleteBusiness", err);
    return res.status(500).json({
      message: clientSafeMessage(err, "We couldn't remove that business request. Try again."),
    });
  }
}

export async function updateBusinessOperationalStatus(req: Request, res: Response) {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ message: "id is required" });
    const body = req.body as { status?: string; reviewNote?: string } | undefined;
    const raw = body?.status;
    const action =
      raw === "suspended" || raw === "inactive" || raw === "active" ? raw : null;
    if (!action) {
      return res.status(400).json({
        message: "status must be one of: active, suspended, inactive",
      });
    }
    const { updateBusinessOperationalStatus: applyOperationalStatus } = await import(
      "../services/businessOperationalLifecycle.service.js"
    );
    await applyOperationalStatus(id, action, {
      reviewNote: body?.reviewNote,
      adminUserId: req.user?.userId ?? req.user?.id,
    });
    return res.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg === "Business not found") {
      return res.status(404).json({ message: msg });
    }
    if (msg.startsWith("Cannot")) {
      return res.status(400).json({ message: msg });
    }
    logServerError("platform.updateBusinessOperationalStatus", err);
    return res.status(500).json({
      message: clientSafeMessage(err, "We couldn't update business status. Try again."),
    });
  }
}

export async function listAuditLogs(req: Request, res: Response) {
  try {
    const take = Math.min(Math.max(Number(req.query.take) || 100, 1), 200);
    const skip = Math.max(Number(req.query.skip) || 0, 0);
    const result = await platformService.listAuditLogsForAdmin({ take, skip });
    return res.json(result);
  } catch (err) {
    logServerError("platform.listAuditLogs", err);
    return res.status(500).json({
      message: clientSafeMessage(err, "We couldn't load audit logs. Try again."),
    });
  }
}

export async function updateBusinessSubscriptionTier(req: Request, res: Response) {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ message: "id is required" });
    const tier = req.body?.subscriptionTier;
    if (tier !== "basic" && tier !== "premium" && tier !== "enterprise") {
      return res.status(400).json({ message: "subscriptionTier must be basic, premium, or enterprise" });
    }
    const actorUserId = req.user?.userId ?? req.user?.id;
    if (!actorUserId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    const business = await platformService.updateBusinessSubscriptionTier(id, tier, actorUserId);
    return res.json({ success: true, business });
  } catch (err) {
    logServerError("platform.updateBusinessSubscriptionTier", err);
    return res.status(400).json({
      message: clientSafeMessage(err, "We couldn't update the subscription tier. Try again."),
    });
  }
}

export async function updateBusiness(req: Request, res: Response) {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ message: "id is required" });
    const body = req.body as Record<string, unknown>;
    const business = await platformService.updateBusinessKyc(id, {
      legalContactName:
        body.legalContactName !== undefined ? (body.legalContactName as string | null) : undefined,
      contactEmail: body.contactEmail !== undefined ? (body.contactEmail as string | null) : undefined,
      contactPhone: body.contactPhone !== undefined ? (body.contactPhone as string | null) : undefined,
      registeredAddress:
        body.registeredAddress !== undefined ? (body.registeredAddress as string | null) : undefined,
    });
    return res.json({ success: true, business });
  } catch (err) {
    logServerError("platform.updateBusiness", err);
    return res.status(400).json({
      message: clientSafeMessage(err, "We couldn't save business details. Try again."),
    });
  }
}

export async function listAnnouncements(req: Request, res: Response) {
  try {
    const take = Math.min(Math.max(Number(req.query.take) || 50, 1), 200);
    const skip = Math.max(Number(req.query.skip) || 0, 0);
    const result = await platformService.listAnnouncementsForAdmin({ take, skip });
    return res.json(result);
  } catch (err) {
    logServerError("platform.listAnnouncements", err);
    return res.status(500).json({
      message: clientSafeMessage(err, "We couldn't load announcement history. Try again."),
    });
  }
}

export async function sendAnnouncement(req: Request, res: Response) {
  try {
    const body = req.body as Record<string, unknown>;
    const title = typeof body.title === "string" ? body.title : "";
    const message = typeof body.message === "string" ? body.message : typeof body.body === "string" ? body.body : "";
    const url = typeof body.url === "string" ? body.url : undefined;
    const audienceRaw = typeof body.audience === "string" ? body.audience : "all";
    const audience: platformService.PlatformAnnouncementAudience =
      audienceRaw === "managers" ||
      audienceRaw === "employees" ||
      audienceRaw === "admins"
        ? audienceRaw
        : "all";
    if (!title.trim() || !message.trim()) {
      return res.status(400).json({ message: "title and message are required" });
    }
    const adminId = req.user?.userId ?? req.user?.id;
    if (!adminId) return res.status(401).json({ message: "Authentication required" });

    const priorityRaw = typeof body.priority === "string" ? body.priority : "normal";
    const priority = priorityRaw === "high" ? "high" : "normal";
    const channelsBody =
      body.channels && typeof body.channels === "object"
        ? (body.channels as Record<string, unknown>)
        : undefined;

    const result = await platformService.sendPlatformAnnouncement({
      title,
      body: message,
      url,
      audience,
      createdById: adminId,
      priority,
      channels: {
        inApp: channelsBody?.inApp !== false,
        push: channelsBody?.push !== false,
        email: channelsBody?.email === true,
      },
      announcementId:
        typeof body.announcementId === "string" ? body.announcementId : undefined,
    });
    return res.json({
      success: true,
      recipientCount: result.recipientCount,
      announcementId: result.announcementId,
      message: `Announcement queued for ${result.recipientCount} user(s).`,
    });
  } catch (err) {
    logServerError("platform.sendAnnouncement", err);
    return res.status(400).json({
      message: clientSafeMessage(err, "We couldn't send that announcement. Try again."),
    });
  }
}

export async function impersonate(req: Request, res: Response) {
  try {
    const adminId = req.user?.userId ?? req.user?.id;
    if (!adminId) return res.status(401).json({ message: "Authentication required" });
    const businessId = (req.body as { businessId?: string }).businessId;
    if (!businessId || typeof businessId !== "string") {
      return res.status(400).json({ message: "businessId is required" });
    }
    const result = await platformService.impersonateBusinessManager(adminId, businessId);
    return res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg === "Forbidden") {
      return res.status(403).json({ message: "Insufficient permissions" });
    }
    if (msg === "Business not found") {
      return res.status(404).json({ message: msg });
    }
    logServerError("platform.impersonate", err);
    return res.status(500).json({
      message: clientSafeMessage(err, "We couldn't open support view for that venue. Try again."),
    });
  }
}


export async function getSubscriptionMonitoring(req: Request, res: Response) {
  try {
    const days = Math.min(Math.max(Number(req.query.days) || 30, 7), 90);
    const { getPlatformSubscriptionMonitoringBundle } = await import(
      "../services/commercial/platformSubscriptionMonitoring.service.js"
    );
    const data = await getPlatformSubscriptionMonitoringBundle(days);
    return res.json(data);
  } catch (err) {
    logServerError("platform.getSubscriptionMonitoring", err);
    return res.status(500).json({
      message: clientSafeMessage(err, "We couldn't load subscription monitoring."),
    });
  }
}

export async function listSubscriptionActivity(req: Request, res: Response) {
  try {
    const filterRaw = typeof req.query.filter === "string" ? req.query.filter : "all";
    const allowedFilters = new Set([
      "all",
      "successful",
      "failed",
      "trialing",
      "active",
      "cancelled",
      "past_due",
    ]);
    const filter = allowedFilters.has(filterRaw) ? filterRaw : "all";
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    const take = Math.min(Math.max(Number(req.query.take) || 25, 1), 100);
    const skip = Math.max(Number(req.query.skip) || 0, 0);
    const sortRaw = typeof req.query.sort === "string" ? req.query.sort : "date";
    const sort = ["date", "business", "status", "amount"].includes(sortRaw)
      ? (sortRaw as "date" | "business" | "status" | "amount")
      : "date";
    const sortDir = req.query.sortDir === "asc" ? "asc" : "desc";

    const { listPlatformSubscriptionActivity } = await import(
      "../services/commercial/platformSubscriptionMonitoring.service.js"
    );
    const result = await listPlatformSubscriptionActivity({
      filter: filter as import("../services/commercial/platformSubscriptionMonitoring.service.js").PlatformSubscriptionActivityFilter,
      q,
      take,
      skip,
      sort,
      sortDir,
    });
    return res.json(result);
  } catch (err) {
    logServerError("platform.listSubscriptionActivity", err);
    return res.status(500).json({
      message: clientSafeMessage(err, "We couldn't load subscription activity."),
    });
  }
}

export async function getCommercialIntelligence(_req: Request, res: Response) {
  const startedAt = Date.now();
  try {
    const { getPlatformCommercialIntelligence } = await import(
      "../services/commercial/platformCommercialIntelligence.service.js"
    );
    const data = await getPlatformCommercialIntelligence();
    if (process.env.NODE_ENV !== "production") {
      console.info("[platform.getCommercialIntelligence] ok", {
        ms: Date.now() - startedAt,
        businessesScored: data.segments.growthCandidates.length +
          data.segments.atRisk.length +
          data.segments.premiumOpportunities.length +
          data.segments.enterpriseCandidates.length,
      });
    }
    return res.json(data);
  } catch (err) {
    logServerError("platform.getCommercialIntelligence", err, { ms: Date.now() - startedAt });
    return res.status(500).json({
      message: clientSafeMessage(err, "We couldn't load commercial intelligence."),
    });
  }
}

export async function listSponsoredProgrammes(_req: Request, res: Response) {
  return res.json({
    programmes: Object.values(SPONSORED_PROGRAMMES).map((p) => ({
      programmeKey: p.programmeKey,
      profileKey: p.profileKey,
      labelKey: p.labelKey,
    })),
    capabilityProfiles: SPONSORED_CAPABILITY_PROFILE_KEYS.map((profileKey) => ({
      profileKey,
      labelKey: `sponsored.profiles.${profileKey}`,
    })),
  });
}

export async function listBusinessSponsoredAccess(req: Request, res: Response) {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ message: "id is required" });
    const business = await prisma.business.findUnique({ where: { id }, select: { id: true } });
    if (!business) return res.status(404).json({ message: "Business not found" });
    const grants = await listSponsoredGrantsForBusiness(id);
    return res.json({ grants });
  } catch (err) {
    logServerError("platform.listBusinessSponsoredAccess", err);
    return res.status(500).json({
      message: clientSafeMessage(err, "We couldn't load sponsored access grants."),
    });
  }
}

export async function createBusinessSponsoredAccess(req: Request, res: Response) {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ message: "id is required" });
    const business = await prisma.business.findUnique({ where: { id }, select: { id: true } });
    if (!business) return res.status(404).json({ message: "Business not found" });

    const body = req.body as Record<string, unknown>;
    const programmeKey = typeof body.programmeKey === "string" ? body.programmeKey.trim() : "";
    if (!isSponsoredProgrammeKey(programmeKey)) {
      return res.status(400).json({ message: "programmeKey must be a registered sponsored programme" });
    }

    const actorUserId = req.user?.userId ?? req.user?.id;
    const activate = body.activate !== false;
    const notes = typeof body.notes === "string" ? body.notes : null;
    const capabilityProfileRaw =
      typeof body.capabilityProfileKey === "string" ? body.capabilityProfileKey.trim() : null;
    const capabilityProfileKey =
      capabilityProfileRaw && isSponsoredCapabilityProfileKey(capabilityProfileRaw)
        ? (capabilityProfileRaw as SponsoredCapabilityProfileKey)
        : null;
    const expiresAtRaw = typeof body.expiresAt === "string" ? body.expiresAt.trim() : null;
    const expiresAt = expiresAtRaw ? new Date(expiresAtRaw) : null;
    if (expiresAtRaw && Number.isNaN(expiresAt?.getTime())) {
      return res.status(400).json({ message: "expiresAt must be a valid ISO date" });
    }

    const grant = await createSponsoredAccessGrant({
      businessId: id,
      programmeKey: programmeKey as SponsoredProgrammeKey,
      capabilityProfileKey,
      notes,
      expiresAt,
      activate,
      approvedByUserId: activate ? actorUserId ?? null : null,
    });
    return res.status(201).json({ grant });
  } catch (err) {
    logServerError("platform.createBusinessSponsoredAccess", err);
    return res.status(400).json({
      message: clientSafeMessage(err, "We couldn't create the sponsored access grant."),
    });
  }
}

export async function activateBusinessSponsoredAccess(req: Request, res: Response) {
  try {
    const { id, grantId } = req.params;
    if (!id || !grantId) return res.status(400).json({ message: "id and grantId are required" });
    const actorUserId = req.user?.userId ?? req.user?.id;
    if (!actorUserId) return res.status(401).json({ message: "Authentication required" });

    const grant = await prisma.sponsoredAccessGrant.findFirst({
      where: { id: grantId, businessId: id },
      select: { id: true },
    });
    if (!grant) return res.status(404).json({ message: "Sponsored access grant not found" });

    const updated = await activateSponsoredAccessGrant(grantId, actorUserId);
    return res.json({ grant: updated });
  } catch (err) {
    logServerError("platform.activateBusinessSponsoredAccess", err);
    return res.status(400).json({
      message: clientSafeMessage(err, "We couldn't activate sponsored access."),
    });
  }
}

export async function revokeBusinessSponsoredAccess(req: Request, res: Response) {
  try {
    const { id, grantId } = req.params;
    if (!id || !grantId) return res.status(400).json({ message: "id and grantId are required" });

    const grant = await prisma.sponsoredAccessGrant.findFirst({
      where: { id: grantId, businessId: id },
      select: { id: true },
    });
    if (!grant) return res.status(404).json({ message: "Sponsored access grant not found" });

    const updated = await revokeSponsoredAccessGrant(grantId);
    return res.json({ grant: updated });
  } catch (err) {
    logServerError("platform.revokeBusinessSponsoredAccess", err);
    return res.status(400).json({
      message: clientSafeMessage(err, "We couldn't revoke sponsored access."),
    });
  }
}

export async function updateBusinessSponsoredAccess(req: Request, res: Response) {
  try {
    const { id, grantId } = req.params;
    if (!id || !grantId) return res.status(400).json({ message: "id and grantId are required" });

    const grant = await prisma.sponsoredAccessGrant.findFirst({
      where: { id: grantId, businessId: id },
      select: { id: true },
    });
    if (!grant) return res.status(404).json({ message: "Sponsored access grant not found" });

    const body = req.body as Record<string, unknown>;
    const updates: Parameters<typeof updateSponsoredAccessGrant>[1] = {};

    if (typeof body.programmeKey === "string") {
      const programmeKey = body.programmeKey.trim();
      if (!isSponsoredProgrammeKey(programmeKey)) {
        return res.status(400).json({ message: "programmeKey must be a registered sponsored programme" });
      }
      updates.programmeKey = programmeKey as SponsoredProgrammeKey;
    }

    if (body.capabilityProfileKey === null) {
      updates.capabilityProfileKey = null;
    } else if (typeof body.capabilityProfileKey === "string") {
      const profileKey = body.capabilityProfileKey.trim();
      if (!isSponsoredCapabilityProfileKey(profileKey)) {
        return res.status(400).json({ message: "capabilityProfileKey must be starter, business, or enterprise" });
      }
      updates.capabilityProfileKey = profileKey as SponsoredCapabilityProfileKey;
    }

    if (typeof body.notes === "string") {
      updates.notes = body.notes;
    }

    if (body.clearExpiresAt === true) {
      updates.clearExpiresAt = true;
    } else if (typeof body.expiresAt === "string") {
      const expiresAtRaw = body.expiresAt.trim();
      if (!expiresAtRaw) {
        updates.clearExpiresAt = true;
      } else {
        const expiresAt = new Date(expiresAtRaw);
        if (Number.isNaN(expiresAt.getTime())) {
          return res.status(400).json({ message: "expiresAt must be a valid ISO date" });
        }
        updates.expiresAt = expiresAt;
      }
    }

    const updated = await updateSponsoredAccessGrant(grantId, updates);
    return res.json({ grant: updated });
  } catch (err) {
    logServerError("platform.updateBusinessSponsoredAccess", err);
    return res.status(400).json({
      message: clientSafeMessage(err, "We couldn't update sponsored access."),
    });
  }
}
