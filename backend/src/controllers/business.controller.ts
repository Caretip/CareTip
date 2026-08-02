import type { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import * as businessService from "../services/business.service.js";
import { prisma } from "../prisma.js";
import {
  logServerError,
  clientSafeMessage,
  CLIENT_FALLBACK,
} from "../utils/httpErrors.js";
import { STATS_FETCH_ERROR_CODE, StatsFetchError } from "../utils/statsErrors.js";
import { logDashboardTiming } from "../utils/dashboardTiming.js";
import { logDashboardTenant } from "../utils/dashboardTenantLog.js";
import { isStatsScopeAllowedForTier } from "../config/subscriptionCapabilities.js";
import {
  getSubscriptionTierForBusinessId,
  subscriptionBypass,
  subscriptionRequiredPayload,
} from "../services/subscriptionEntitlement.service.js";
import { getBusinessQrAnalytics, type QrAnalyticsTimeframe } from "../services/qr/qrAnalytics.service.js";

function statsErrorHttpStatus(err: unknown): number {
  if (err instanceof StatsFetchError) {
    const reason = err.meta?.reason;
    if (reason === "missing_business_id" || reason === "business_row_missing") return 404;
  }
  if (err instanceof Error && err.message === "Business not found") return 404;
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2021" || err.code === "P2022") return 503;
    if (["P1001", "P1002", "P1008", "P1017"].includes(err.code)) return 503;
  }
  return 500;
}
import { uploadManagerBusinessLogoImage, uploadManagerVerificationDocument, removeStoredUploadReferenceIfPossible, uploadManagerBusinessBannerImage } from "../services/upload.service.js";
import { removeUploadedObjectByPublicUrlIfPossible } from "../lib/supabaseStorageClient.js";
import * as kycService from "../services/kyc.service.js";
import * as brandingService from "../services/businessBranding.service.js";

export async function generateInvite(req: Request, res: Response) {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    const result = await businessService.generateInviteCode(userId);
    return res.json(result);
  } catch (err) {
    logServerError("business.generateInvite", err);
    return res.status(400).json({
      message: clientSafeMessage(err, CLIENT_FALLBACK.business),
    });
  }
}

export async function getMyProfile(req: Request, res: Response) {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    const business = await businessService.getBusinessByUserId(userId);
    if (!business) {
      return res.status(404).json({
        success: false,
        code: "BUSINESS_NOT_FOUND",
        message: "Business not found",
      });
    }
    const profile = await businessService.getManagerBusinessProfileById(business.id);
    if (!profile) {
      return res.status(404).json({
        success: false,
        code: "BUSINESS_NOT_FOUND",
        message: "Business not found",
      });
    }
    return res.json(profile);
  } catch (err) {
    logServerError("business.getMyProfile", err, { userId: req.user?.userId ?? req.user?.id });
    const status =
      err instanceof Prisma.PrismaClientKnownRequestError &&
      ["P1001", "P1002", "P1008", "P1017", "P2021", "P2022"].includes(err.code)
        ? 503
        : 500;
    return res.status(status).json({
      success: false,
      message: clientSafeMessage(err, "We couldn't load your business profile."),
    });
  }
}

export async function validateInvite(req: Request, res: Response) {
  try {
    const code = typeof req.query?.code === "string" ? req.query.code : "";
    const clientKey =
      (typeof req.ip === "string" && req.ip) ||
      (typeof req.headers["x-forwarded-for"] === "string"
        ? req.headers["x-forwarded-for"].split(",")[0]?.trim()
        : "unknown");
    const r = await businessService.validateInviteCode(code, {
      clientKey: `validate:${clientKey}`,
      ipKey: clientKey,
    });
    if (!r.ok) {
      return res.status(400).json({ ok: false, message: "Invalid or expired invite code" });
    }
    return res.json({
      ok: true,
      businessName: r.businessName,
      businessId: r.businessId,
      businessSlug: r.businessSlug,
      businessLocation: r.businessLocation ?? null,
    });
  } catch (err) {
    logServerError("business.validateInvite", err);
    return res.status(400).json({
      ok: false,
      message: clientSafeMessage(err, CLIENT_FALLBACK.business),
    });
  }
}

export async function listInviteHistory(req: Request, res: Response) {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    const take = Math.min(100, Math.max(1, Number(req.query.take ?? 20) || 20));
    const history = await businessService.getInviteRedemptionHistory(userId, take);
    return res.json({ items: history });
  } catch (err) {
    logServerError("business.listInviteHistory", err);
    return res.status(400).json({
      message: clientSafeMessage(err, CLIENT_FALLBACK.business),
    });
  }
}

function parseProfileBody(body: Record<string, unknown>): Parameters<typeof businessService.updateManagerBusinessProfile>[1] {
  const name =
    typeof body.name === "string"
      ? body.name
      : typeof body.businessName === "string"
        ? body.businessName
        : undefined;
  return {
    name,
    legalBusinessName: typeof body.legalBusinessName === "string" ? body.legalBusinessName : undefined,
    businessType: body.businessType === undefined ? undefined : (body.businessType as string | null),
    location: body.location === undefined ? undefined : (body.location as string | null),
    registeredAddress:
      body.registeredAddress === undefined ? undefined : (body.registeredAddress as string | null),
    contactPhone: body.contactPhone === undefined ? undefined : (body.contactPhone as string | null),
    website: body.website === undefined ? undefined : (body.website as string | null),
  };
}

export async function patchMyProfile(req: Request, res: Response) {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    const body = req.body as Record<string, unknown>;
    await businessService.updateManagerBusinessProfile(userId, parseProfileBody(body));
    const profile = await businessService.getManagerBusinessProfile(userId);
    return res.json(profile);
  } catch (err) {
    logServerError("business.patchMyProfile", err);
    return res.status(400).json({
      message: clientSafeMessage(err, CLIENT_FALLBACK.business),
    });
  }
}

/** Same as PATCH — REST clients may use PUT for full profile replace-style updates. */
export async function putMyProfile(req: Request, res: Response) {
  return patchMyProfile(req, res);
}

export async function regenerateBusinessSlug(req: Request, res: Response) {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    const r = await businessService.regenerateManagerBusinessSlug(userId);
    return res.json(r);
  } catch (err) {
    logServerError("business.regenerateBusinessSlug", err);
    return res.status(400).json({
      message: clientSafeMessage(err, CLIENT_FALLBACK.business),
    });
  }
}

export async function getMyKycStatus(req: Request, res: Response) {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    const status = await kycService.getManagerKycStatus(userId);
    return res.json(status);
  } catch (err) {
    logServerError("business.getMyKycStatus", err);
    return res.status(400).json({
      message: clientSafeMessage(err, CLIENT_FALLBACK.business),
    });
  }
}

export async function uploadMyKycDocument(req: Request, res: Response) {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    const documentType = kycService.parseKycDocumentType(
      (req.body as { documentType?: unknown })?.documentType ??
        (req.query as { documentType?: unknown })?.documentType,
    );
    if (!documentType) {
      return res.status(400).json({
        message: "documentType must be registration, address, governmentId, or additional",
      });
    }
    const b = await businessService.getBusinessByUserId(userId);
    if (!b) {
      return res.status(404).json({ message: "Business not found" });
    }
    const file = req.file;
    if (!file?.buffer) {
      return res.status(400).json({ message: "File is required (multipart field name: file)" });
    }

    const publicPath = await uploadManagerVerificationDocument(file.buffer, file.mimetype, b.id);

    try {
      const result = await kycService.upsertManagerKycDocument(userId, documentType, publicPath);
      return res.json({
        success: true,
        path: publicPath,
        documentType,
        kycUiStatus: result.kycUiStatus,
        kycDocuments: result.kycDocuments,
      });
    } catch (dbErr) {
      await removeStoredUploadReferenceIfPossible(publicPath);
      throw dbErr;
    }
  } catch (err) {
    logServerError("business.uploadMyKycDocument", err);
    return res.status(400).json({
      message: clientSafeMessage(err, CLIENT_FALLBACK.business),
    });
  }
}

export async function submitMyKyc(req: Request, res: Response) {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    const status = await kycService.submitManagerKycForReview(userId);
    return res.json({ success: true, ...status });
  } catch (err) {
    logServerError("business.submitMyKyc", err);
    return res.status(400).json({
      message: clientSafeMessage(err, CLIENT_FALLBACK.business),
    });
  }
}

export async function uploadMyLogo(req: Request, res: Response) {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    const b = await businessService.getBusinessByUserId(userId);
    if (!b) {
      return res.status(404).json({ message: "Business not found" });
    }
    const file = req.file;
    if (!file?.buffer) {
      return res.status(400).json({ message: "File is required (multipart field name: file)" });
    }

    const logoPathToStore = await uploadManagerBusinessLogoImage(file.buffer, file.mimetype, b.id);

    try {
      await prisma.business.update({
        where: { id: b.id },
        data: { logoPath: logoPathToStore },
      });
      brandingService.trackBrandingLogoUploaded(b.id);
    } catch (dbErr) {
      await removeUploadedObjectByPublicUrlIfPossible(logoPathToStore);
      throw dbErr;
    }
    return res.json({ success: true, path: logoPathToStore });
  } catch (err) {
    logServerError("business.uploadMyLogo", err);
    return res.status(400).json({
      message: clientSafeMessage(err, CLIENT_FALLBACK.business),
    });
  }
}

export async function getMyBrandingSettings(req: Request, res: Response) {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    const b = await businessService.getBusinessByUserId(userId);
    if (!b) {
      return res.status(404).json({ message: "Business not found" });
    }
    const settings = await brandingService.getBrandingSettingsForManager(b.id);
    if (!settings) {
      return res.status(404).json({ message: "Business not found" });
    }
    return res.json(settings);
  } catch (err) {
    logServerError("business.getMyBrandingSettings", err);
    return res.status(500).json({
      message: clientSafeMessage(err, "We couldn't load branding settings."),
    });
  }
}

export async function patchMyBrandingSettings(req: Request, res: Response) {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    const b = await businessService.getBusinessByUserId(userId);
    if (!b) {
      return res.status(404).json({ message: "Business not found" });
    }
    const body = req.body as Record<string, unknown>;
    const settings = await brandingService.updateBrandingSettings(b.id, {
      brandPrimaryColor:
        typeof body.brandPrimaryColor === "string" ? body.brandPrimaryColor : undefined,
      brandSecondaryColor:
        typeof body.brandSecondaryColor === "string" ? body.brandSecondaryColor : undefined,
      welcomeMessage:
        body.welcomeMessage === undefined
          ? undefined
          : body.welcomeMessage === null
            ? null
            : String(body.welcomeMessage),
      thankYouMessage:
        body.thankYouMessage === undefined
          ? undefined
          : body.thankYouMessage === null
            ? null
            : String(body.thankYouMessage),
      brandDisplayName:
        body.brandDisplayName === undefined
          ? undefined
          : body.brandDisplayName === null
            ? null
            : String(body.brandDisplayName),
      brandTagline:
        body.brandTagline === undefined
          ? undefined
          : body.brandTagline === null
            ? null
            : String(body.brandTagline),
      qrTemplate: typeof body.qrTemplate === "string" ? body.qrTemplate : undefined,
      qrBorderStyle: typeof body.qrBorderStyle === "string" ? body.qrBorderStyle : undefined,
      qrShape: typeof body.qrShape === "string" ? body.qrShape : undefined,
      qrAccentColor:
        body.qrAccentColor === undefined
          ? undefined
          : body.qrAccentColor === null
            ? ""
            : String(body.qrAccentColor),
      qrBackgroundColor:
        typeof body.qrBackgroundColor === "string" ? body.qrBackgroundColor : undefined,
    });
    return res.json(settings);
  } catch (err) {
    logServerError("business.patchMyBrandingSettings", err);
    return res.status(400).json({
      message: clientSafeMessage(err, "We couldn't save branding settings."),
    });
  }
}

export async function uploadMyBanner(req: Request, res: Response) {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    const b = await businessService.getBusinessByUserId(userId);
    if (!b) {
      return res.status(404).json({ message: "Business not found" });
    }
    const file = req.file;
    if (!file?.buffer) {
      return res.status(400).json({ message: "File is required (multipart field name: file)" });
    }

    const bannerPathToStore = await uploadManagerBusinessBannerImage(file.buffer, file.mimetype, b.id);

    try {
      await brandingService.setBusinessBannerPath(b.id, bannerPathToStore);
    } catch (dbErr) {
      await removeUploadedObjectByPublicUrlIfPossible(bannerPathToStore);
      throw dbErr;
    }
    return res.json({ success: true, path: bannerPathToStore });
  } catch (err) {
    logServerError("business.uploadMyBanner", err);
    return res.status(400).json({
      message: clientSafeMessage(err, "We couldn't upload your banner. Please try again."),
    });
  }
}

export async function getById(req: Request, res: Response) {
  try {
    const { businessId } = req.params;
    if (!businessId) {
      return res.status(400).json({ message: "businessId is required" });
    }
    const business = await businessService.getPublicBusinessById(businessId);
    if (!business) {
      return res.status(404).json({ message: "Business not found" });
    }
    return res.json(business);
  } catch (err) {
    logServerError("business.getById", err);
    return res.status(404).json({
      message: clientSafeMessage(err, "We couldn't find this business."),
    });
  }
}

export async function getMyStats(req: Request, res: Response) {
  const userId = req.user?.userId ?? req.user?.id;
  const tf = req.query.timeframe;
  const timeframe =
    tf === "week" || tf === "month" || tf === "year" || tf === "all"
      ? tf
      : "month";
  const scopeRaw = typeof req.query.scope === "string" ? req.query.scope.trim() : "";
  const scope =
    scopeRaw === "summary" || scopeRaw === "analytics" || scopeRaw === "roster"
      ? scopeRaw
      : "full";

  try {
    if (!userId) {
      return res.status(401).json({
        success: false,
        code: "AUTH_REQUIRED",
        message: "Authentication required",
      });
    }
    const business = await businessService.getBusinessIdForManagerUser(userId);
    if (!business) {
      return res.status(404).json({
        success: false,
        code: "BUSINESS_NOT_FOUND",
        message: "Business not found",
      });
    }
    logDashboardTenant("business.getMyStats", {
      userId,
      businessId: business.id,
      role: req.user?.role ?? null,
      timeframe,
      scope,
    });
    if (!subscriptionBypass(req)) {
      const tier = await getSubscriptionTierForBusinessId(business.id);
      if (!isStatsScopeAllowedForTier(tier, scope)) {
        return res.status(403).json(subscriptionRequiredPayload("advancedAnalytics"));
      }
    }
    const stats = await logDashboardTiming(
      `business.myStats.${scope}`,
      { businessId: business.id, timeframe, scope },
      () => businessService.getBusinessStats(business.id, timeframe, scope),
    );
    return res.json(stats);
  } catch (err) {
    const businessRow = userId
      ? await businessService.getBusinessIdForManagerUser(userId).catch(() => null)
      : null;
    logServerError("business.getMyStats", err, {
      userId,
      timeframe,
      businessId: businessRow?.id ?? null,
    });
    if (err instanceof StatsFetchError) {
      const status = statsErrorHttpStatus(err);
      return res.status(status).json({
        success: false,
        code: err.code,
        message: clientSafeMessage(err, CLIENT_FALLBACK.businessStats),
      });
    }
    const status = statsErrorHttpStatus(err);
    return res.status(status).json({
      success: false,
      code: STATS_FETCH_ERROR_CODE,
      message: clientSafeMessage(err, CLIENT_FALLBACK.businessStats),
    });
  }
}

export async function getMyQrAnalytics(req: Request, res: Response) {
  const userId = req.user?.userId ?? req.user?.id;
  const tf = req.query.timeframe;
  const timeframe: QrAnalyticsTimeframe =
    tf === "week" || tf === "year" ? tf : "month";

  try {
    if (!userId) {
      return res.status(401).json({
        success: false,
        code: "AUTH_REQUIRED",
        message: "Authentication required",
      });
    }
    const business = await businessService.getBusinessIdForManagerUser(userId);
    if (!business) {
      return res.status(404).json({
        success: false,
        code: "BUSINESS_NOT_FOUND",
        message: "Business not found",
      });
    }
    if (!subscriptionBypass(req)) {
      const tier = await getSubscriptionTierForBusinessId(business.id);
      if (!isStatsScopeAllowedForTier(tier, "analytics")) {
        return res.status(403).json(subscriptionRequiredPayload("advancedAnalytics"));
      }
    }
    const analytics = await getBusinessQrAnalytics(business.id, timeframe);
    return res.json(analytics);
  } catch (err) {
    logServerError("business.getMyQrAnalytics", err, { userId, timeframe });
    return res.status(500).json({
      success: false,
      message: clientSafeMessage(err, CLIENT_FALLBACK.businessStats),
    });
  }
}

export async function getStats(req: Request, res: Response) {
  /** @deprecated Client-supplied businessId is ignored — tenant resolved from JWT. */
  return getMyStats(req, res);
}
