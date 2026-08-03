import { Router } from "express";
import { Role } from "@prisma/client";
import { authMiddleware, requireRole, requireVerifiedEmail } from "../middleware/auth.middleware.js";
import { requireCompletedOnboarding } from "../middleware/requireCompletedOnboarding.middleware.js";
import { mobileWebHandoffCreateRateLimitWithAudit } from "../middleware/authRateLimit.middleware.js";
import * as mobileWebHandoffController from "../controllers/mobileWebHandoff.controller.js";

const router = Router();

/**
 * Mobile → web authenticated handoff (billing).
 * Requires a valid mobile access JWT; never accepts unauthenticated issuance.
 * Rate limit runs after auth so limits apply per user + IP.
 */
router.post(
  "/create-billing-session",
  authMiddleware,
  requireVerifiedEmail,
  requireRole(Role.MANAGER),
  requireCompletedOnboarding,
  mobileWebHandoffCreateRateLimitWithAudit,
  mobileWebHandoffController.createBillingSession,
);

export default router;
