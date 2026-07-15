import { Router } from "express";
import { Role } from "@prisma/client";
import { authMiddleware, requireRole, requireVerifiedEmail } from "../middleware/auth.middleware.js";
import { requireBusinessVerificationCapability } from "../middleware/requireBusinessVerificationCapability.middleware.js";
import { requireCompletedOnboarding } from "../middleware/requireCompletedOnboarding.middleware.js";
import * as businessController from "../controllers/business.controller.js";
import * as activityController from "../controllers/activity.controller.js";
import { businessUploadLogo, businessUploadVerification, businessUploadBanner } from "../middleware/businessUpload.middleware.js";
import { requireBusinessLogoUpload } from "../middleware/requireBusinessLogoUpload.middleware.js";
import { requireFeature } from "../services/subscriptionEntitlement.service.js";

const requireBrandingCustomization = requireFeature("brandingCustomization");
import { clientSafeMessage } from "../utils/httpErrors.js";
import { validateInviteCodeRateLimit } from "../middleware/authRateLimit.middleware.js";

const router = Router();

/** Public: validate an invite code before sign-up. */
router.get("/invite/validate", validateInviteCodeRateLimit, businessController.validateInvite);

/** Manager profile — email must be verified; KYC pending managers use this to poll status. */
router.get("/profile", authMiddleware, requireVerifiedEmail, requireRole(Role.MANAGER), businessController.getMyProfile);
router.get(
  "/kyc/status",
  authMiddleware,
  requireVerifiedEmail,
  requireRole(Role.MANAGER),
  businessController.getMyKycStatus,
);
router.post(
  "/kyc/documents",
  authMiddleware,
  requireVerifiedEmail,
  requireRole(Role.MANAGER),
  (req, res, next) =>
    businessUploadVerification(req, res, (err: unknown) => {
      if (err) {
        return res.status(400).json({
          message: clientSafeMessage(
            err instanceof Error ? err : new Error(String(err)),
            "We couldn't upload your document. Please try again.",
          ),
        });
      }
      next();
    }),
  businessController.uploadMyKycDocument,
);
router.post(
  "/kyc/submit",
  authMiddleware,
  requireVerifiedEmail,
  requireRole(Role.MANAGER),
  businessController.submitMyKyc,
);
router.patch(
  "/profile",
  authMiddleware,
  requireVerifiedEmail,
  requireRole(Role.MANAGER),
  businessController.patchMyProfile
);
router.put(
  "/profile",
  authMiddleware,
  requireVerifiedEmail,
  requireRole(Role.MANAGER),
  businessController.putMyProfile
);
router.post(
  "/profile/logo",
  authMiddleware,
  requireVerifiedEmail,
  requireRole(Role.MANAGER),
  (req, res, next) =>
    businessUploadLogo(req, res, (err: unknown) => {
      if (err) {
        return res.status(400).json({
          message: clientSafeMessage(
            err instanceof Error ? err : new Error(String(err)),
            "We couldn't upload your logo. Please try again.",
          ),
        });
      }
      next();
    }),
  requireBusinessLogoUpload,
  businessController.uploadMyLogo
);

router.get(
  "/profile/branding",
  authMiddleware,
  requireVerifiedEmail,
  requireRole(Role.MANAGER),
  businessController.getMyBrandingSettings,
);
router.patch(
  "/profile/branding",
  authMiddleware,
  requireVerifiedEmail,
  requireRole(Role.MANAGER),
  requireBrandingCustomization,
  businessController.patchMyBrandingSettings,
);
router.post(
  "/profile/banner",
  authMiddleware,
  requireVerifiedEmail,
  requireRole(Role.MANAGER),
  (req, res, next) =>
    businessUploadBanner(req, res, (err: unknown) => {
      if (err) {
        return res.status(400).json({
          message: clientSafeMessage(
            err instanceof Error ? err : new Error(String(err)),
            "We couldn't upload your banner. Please try again.",
          ),
        });
      }
      next();
    }),
  requireBrandingCustomization,
  businessController.uploadMyBanner,
);

router.post(
  "/profile/slug/regenerate",
  authMiddleware,
  requireVerifiedEmail,
  requireRole(Role.MANAGER),
  requireBusinessVerificationCapability("qrCodes"),
  businessController.regenerateBusinessSlug
);

router.post(
  "/generate-invite",
  authMiddleware,
  requireVerifiedEmail,
  requireRole(Role.MANAGER),
  businessController.generateInvite
);

router.get(
  "/invite/history",
  authMiddleware,
  requireVerifiedEmail,
  requireRole(Role.MANAGER),
  businessController.listInviteHistory,
);

/** Legacy aliases — primary handler is `GET /api/business/me/stats` on the main app (see index.ts). */
router.get(
  "/stats/me",
  authMiddleware,
  requireVerifiedEmail,
  requireRole(Role.MANAGER),
  requireCompletedOnboarding,
  businessController.getMyStats
);
router.get(
  "/stats",
  authMiddleware,
  requireVerifiedEmail,
  requireRole(Role.MANAGER),
  requireCompletedOnboarding,
  businessController.getMyStats
);
router.get(
  "/stats/:businessId",
  authMiddleware,
  requireVerifiedEmail,
  requireRole(Role.MANAGER),
  requireCompletedOnboarding,
  businessController.getMyStats,
);

/** Activity Center — SSOT feed from BusinessActivityEvent (must precede /:businessId). */
router.get(
  "/activity",
  authMiddleware,
  requireVerifiedEmail,
  requireRole(Role.MANAGER),
  requireCompletedOnboarding,
  activityController.listActivity,
);

router.get("/:businessId", businessController.getById);

export default router;
