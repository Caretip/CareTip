import { Router } from "express";
import { authMiddleware, requireVerifiedEmail } from "../middleware/auth.middleware.js";
import * as settingsController from "../controllers/settings.controller.js";

const router = Router();

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
router.post("/export", authMiddleware, requireVerifiedEmail, async (req, res) => {
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

