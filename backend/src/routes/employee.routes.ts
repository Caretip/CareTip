import { Router } from "express";
import multer from "multer";
import { Role } from "@prisma/client";
import {
  authMiddleware,
  optionalAuthMiddleware,
  requireRole,
  requireVerifiedEmail,
} from "../middleware/auth.middleware.js";
import { requireBusinessVerificationCapability } from "../middleware/requireBusinessVerificationCapability.middleware.js";
import { requireFeature } from "../services/subscriptionEntitlement.service.js";
import * as employeeController from "../controllers/employee.controller.js";
import * as qrController from "../controllers/qr.controller.js";
import * as goalController from "../controllers/goal.controller.js";
import { isAllowedImageMimetype } from "../services/upload.service.js";
import { MULTER_SAFE_LIMITS } from "../lib/multerUploadLimits.js";

const router = Router();
const goalsPremium = requireFeature("employeeGoals");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { ...MULTER_SAFE_LIMITS, fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (isAllowedImageMimetype(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Unsupported image type. Use JPEG, PNG, GIF, WebP, HEIC, or AVIF. SVG is not allowed."));
    }
  },
});

// Employee self-service (must be before /:employeeId — "me" is not an id here but order matters for other routes)
router.get(
  "/me",
  authMiddleware,
  requireVerifiedEmail,
  requireRole(Role.EMPLOYEE),
  employeeController.getMyProfile,
);
router.get(
  "/me/qr/branded",
  authMiddleware,
  requireVerifiedEmail,
  requireRole(Role.EMPLOYEE),
  qrController.getEmployeeBrandedQr,
);
router.get(
  "/me/qr/branded.png",
  authMiddleware,
  requireVerifiedEmail,
  requireRole(Role.EMPLOYEE),
  qrController.getEmployeeBrandedQr,
);
router.post(
  "/me/ensure-slug",
  authMiddleware,
  requireVerifiedEmail,
  requireRole(Role.EMPLOYEE),
  employeeController.ensureMySlug,
);
router.patch(
  "/me",
  authMiddleware,
  requireVerifiedEmail,
  requireRole(Role.EMPLOYEE),
  employeeController.patchMyProfile,
);
router.post(
  "/me/avatar",
  authMiddleware,
  requireVerifiedEmail,
  requireRole(Role.EMPLOYEE),
  upload.single("avatar"),
  employeeController.uploadMyAvatar,
);
router.get(
  "/me/export",
  authMiddleware,
  requireVerifiedEmail,
  requireRole(Role.EMPLOYEE),
  employeeController.exportMyData,
);
router.delete(
  "/me",
  authMiddleware,
  requireVerifiedEmail,
  requireRole(Role.EMPLOYEE),
  employeeController.deleteMyAccount,
);

router.get(
  "/me/goal",
  authMiddleware,
  requireVerifiedEmail,
  requireRole(Role.EMPLOYEE),
  goalsPremium,
  goalController.getMyGoal,
);
router.put(
  "/me/goal",
  authMiddleware,
  requireVerifiedEmail,
  requireRole(Role.EMPLOYEE),
  goalsPremium,
  goalController.putMyGoal,
);
router.delete(
  "/me/goal",
  authMiddleware,
  requireVerifiedEmail,
  requireRole(Role.EMPLOYEE),
  goalsPremium,
  goalController.deleteMyGoal,
);

// Public: list employees by businessId (must be before :employeeId to avoid matching "")
router.get("/", optionalAuthMiddleware, employeeController.getEmployees);
// Public: single employee by ID (for direct-tip QR landing)
router.get("/:employeeId", employeeController.getEmployeeById);

// Business only: add employee to their business (setup — available while KYC pending, after email verified)
router.post("/", authMiddleware, requireVerifiedEmail, requireRole(Role.MANAGER), employeeController.createEmployee);
/** QR Studio SSOT — idempotent slug repair for tipping-ready staff (must be before :employeeId). */
router.post(
  "/ensure-slugs",
  authMiddleware,
  requireVerifiedEmail,
  requireRole(Role.MANAGER),
  requireBusinessVerificationCapability("qrCodes"),
  employeeController.ensureMissingEmployeeSlugs,
);
router.post(
  "/:employeeId/ensure-slug",
  authMiddleware,
  requireVerifiedEmail,
  requireRole(Role.MANAGER),
  requireBusinessVerificationCapability("qrCodes"),
  employeeController.ensureEmployeeSlug,
);
router.post(
  "/:employeeId/regenerate-slug",
  authMiddleware,
  requireVerifiedEmail,
  requireRole(Role.MANAGER),
  requireBusinessVerificationCapability("qrCodes"),
  employeeController.regenerateEmployeeSlug
);
router.patch(
  "/:employeeId/status",
  authMiddleware,
  requireVerifiedEmail,
  requireRole(Role.MANAGER),
  employeeController.patchEmployeeStatus
);
router.patch(
  "/:employeeId",
  authMiddleware,
  requireVerifiedEmail,
  requireRole(Role.MANAGER),
  employeeController.updateEmployee,
);
router.delete(
  "/:employeeId",
  authMiddleware,
  requireVerifiedEmail,
  requireRole(Role.MANAGER),
  employeeController.deleteEmployee,
);

export default router;
