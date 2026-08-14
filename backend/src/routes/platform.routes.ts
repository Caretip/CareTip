import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { authMiddleware, requireAdminRoleClaim, requirePlatformAdmin } from "../middleware/auth.middleware.js";
import { auditPlatformAccess } from "../middleware/audit.middleware.js";
import {
  platformUploadLogo,
  platformUploadVerification,
} from "../middleware/platformUpload.middleware.js";
import * as platformController from "../controllers/platform.controller.js";
import * as supportTicketController from "../controllers/supportTicket.controller.js";
import { supportTicketReplyLimiter } from "../middleware/supportTicketRateLimit.middleware.js";
import { clientSafeMessage } from "../utils/httpErrors.js";

const router = Router();

router.use(authMiddleware, requireAdminRoleClaim, requirePlatformAdmin, auditPlatformAccess);

function multerHandler(
  mw: (req: Request, res: Response, next: NextFunction) => void,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    mw(req, res, (err: unknown) => {
      if (err) {
        return res.status(400).json({
          message: clientSafeMessage(err, "We couldn't complete the upload. Please try again."),
        });
      }
      next();
    });
  };
}

router.get("/health", platformController.getHealth);
router.get("/stats", platformController.getStats);
router.get("/analytics", platformController.getAnalytics);
router.get("/transactions", platformController.listTransactions);
router.get("/refunds", platformController.listRefunds);
router.get("/refunds/export", platformController.exportRefunds);
router.get("/connect-payouts", platformController.listConnectPayouts);
router.get("/connect-payouts/:id", platformController.getConnectPayout);
router.get("/audit-logs", platformController.listAuditLogs);
router.get("/kyc/metrics", platformController.getKycQueueMetrics);
router.get("/onboarding/metrics", platformController.getOnboardingQueueMetrics);
router.get("/commercial-intelligence", platformController.getCommercialIntelligence);
router.get("/subscriptions/monitoring", platformController.getSubscriptionMonitoring);
router.get("/subscriptions/activity", platformController.listSubscriptionActivity);
router.get("/businesses", platformController.listBusinesses);
router.get("/businesses/:id", platformController.getBusiness);
router.delete("/businesses/:id", platformController.deleteBusiness);
router.post("/businesses/:id/soft-delete", platformController.softDeleteBusiness);
router.post("/businesses/:id/ownership/transfer", async (req, res) => {
  const { transferOwnershipAsPlatform } = await import(
    "../controllers/lifecycleExport.controller.js"
  );
  return transferOwnershipAsPlatform(req, res);
});

/** Slice G — category-specific legal holds (platform-admin only; fail-closed audit). */
router.get("/legal-hold/subjects", async (req, res) => {
  const { searchPlatformLegalHoldSubjects } = await import("../controllers/legalHold.controller.js");
  return searchPlatformLegalHoldSubjects(req, res);
});
router.get("/users/:userId/legal-hold", async (req, res) => {
  const { getPlatformUserLegalHold } = await import("../controllers/legalHold.controller.js");
  return getPlatformUserLegalHold(req, res);
});
router.put("/users/:userId/legal-hold", async (req, res) => {
  const { putPlatformUserLegalHold } = await import("../controllers/legalHold.controller.js");
  return putPlatformUserLegalHold(req, res);
});
router.delete("/users/:userId/legal-hold", async (req, res) => {
  const { deletePlatformUserLegalHold } = await import("../controllers/legalHold.controller.js");
  return deletePlatformUserLegalHold(req, res);
});
router.get("/businesses/:id/legal-hold", async (req, res) => {
  const { getPlatformBusinessLegalHold } = await import("../controllers/legalHold.controller.js");
  return getPlatformBusinessLegalHold(req, res);
});
router.put("/businesses/:id/legal-hold", async (req, res) => {
  const { putPlatformBusinessLegalHold } = await import("../controllers/legalHold.controller.js");
  return putPlatformBusinessLegalHold(req, res);
});
router.delete("/businesses/:id/legal-hold", async (req, res) => {
  const { deletePlatformBusinessLegalHold } = await import("../controllers/legalHold.controller.js");
  return deletePlatformBusinessLegalHold(req, res);
});

router.patch("/businesses/:id/operational-status", platformController.updateBusinessOperationalStatus);
router.patch("/businesses/:id/verify", platformController.verifyBusinessKyc);
router.patch("/businesses/:id/verify-kyc", platformController.verifyBusinessKyc);
router.patch("/businesses/:id/verify-onboarding", platformController.verifyBusinessOnboarding);
router.patch("/businesses/:id/kyc-review-notes", platformController.patchBusinessKycReviewNotes);
router.patch("/businesses/:id/subscription-tier", platformController.updateBusinessSubscriptionTier);
router.get("/sponsored-access/programmes", platformController.listSponsoredProgrammes);
router.get("/businesses/:id/sponsored-access", platformController.listBusinessSponsoredAccess);
router.post("/businesses/:id/sponsored-access", platformController.createBusinessSponsoredAccess);
router.post(
  "/businesses/:id/sponsored-access/:grantId/activate",
  platformController.activateBusinessSponsoredAccess,
);
router.post(
  "/businesses/:id/sponsored-access/:grantId/revoke",
  platformController.revokeBusinessSponsoredAccess,
);
router.patch(
  "/businesses/:id/sponsored-access/:grantId",
  platformController.updateBusinessSponsoredAccess,
);
router.patch("/businesses/:id", platformController.updateBusiness);
router.post(
  "/businesses/:id/logo",
  multerHandler(platformUploadLogo),
  platformController.uploadBusinessLogo,
);
router.post(
  "/businesses/:id/verification-document",
  multerHandler(platformUploadVerification),
  platformController.uploadVerificationDocument,
);
router.post("/impersonate", platformController.impersonate);
router.get("/announcements", platformController.listAnnouncements);
router.post("/announcements", platformController.sendAnnouncement);

router.get("/support/tickets", supportTicketController.listPlatformTickets);
router.get("/support/tickets/:ticketId", supportTicketController.getPlatformTicket);
router.post(
  "/support/tickets/:ticketId/messages",
  supportTicketReplyLimiter,
  supportTicketController.replyPlatformTicket,
);
router.patch(
  "/support/tickets/:ticketId/status",
  supportTicketController.patchPlatformTicketStatus,
);

export default router;
