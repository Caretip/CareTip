import { Router } from "express";
import { Role } from "@prisma/client";
import {
  authMiddleware,
  requireRole,
  requireVerifiedEmail,
} from "../middleware/auth.middleware.js";
import { requireCompletedOnboarding } from "../middleware/requireCompletedOnboarding.middleware.js";
import { productReviewMeRateLimit } from "../middleware/securityRateLimit.middleware.js";
import * as platformProductFeedbackController from "../controllers/platformProductFeedback.controller.js";

const router = Router();

router.get(
  "/me",
  authMiddleware,
  requireVerifiedEmail,
  requireRole(Role.MANAGER, Role.EMPLOYEE),
  requireCompletedOnboarding,
  platformProductFeedbackController.getMyProductReview,
);

router.post(
  "/me",
  authMiddleware,
  requireVerifiedEmail,
  requireRole(Role.MANAGER, Role.EMPLOYEE),
  requireCompletedOnboarding,
  productReviewMeRateLimit,
  platformProductFeedbackController.createMyProductReview,
);

export default router;
