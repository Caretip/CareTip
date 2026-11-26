import { Router } from "express";
import { sharedRateLimit } from "../middleware/sharedRateLimit.middleware.js";
import { authMiddleware, requireVerifiedEmail } from "../middleware/auth.middleware.js";
import * as settingsController from "../controllers/settings.controller.js";

const router = Router();

/** A data export is a heavy job; a person needs one now and then, not dozens. */
const dataExportRequestLimiter = sharedRateLimit({
  scope: "data-export-request",
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: "You have requested several exports recently. Please wait before requesting another.",
  key: (req) => `user:${req.user?.userId ?? req.user?.id ?? "anonymous"}`,
});

router.get("/settings", authMiddleware, requireVerifiedEmail, settingsController.getMySettings);
router.patch("/settings", authMiddleware, requireVerifiedEmail, settingsController.patchMySettings);

router.get(
  "/deletion-status",
  authMiddleware,
  requireVerifiedEmail,
  settingsController.getDeletionStatus,
);
router.post(
  "/deletion-request",
  authMiddleware,
  requireVerifiedEmail,
  settingsController.postDeletionRequest,
);

/** GDPR Slice E — async DSAR export */
router.post("/export", authMiddleware, requireVerifiedEmail, dataExportRequestLimiter, async (req, res) => {
  const { postMyExport } = await import("../controllers/lifecycleExport.controller.js");
  return postMyExport(req, res);
});
router.get("/export/:jobId", authMiddleware, requireVerifiedEmail, async (req, res) => {
  const { getMyExportJob } = await import("../controllers/lifecycleExport.controller.js");
  return getMyExportJob(req, res);
});
router.get("/export/:jobId/download", authMiddleware, requireVerifiedEmail, async (req, res) => {
  const { downloadMyExport } = await import("../controllers/lifecycleExport.controller.js");
  return downloadMyExport(req, res);
});

export default router;

