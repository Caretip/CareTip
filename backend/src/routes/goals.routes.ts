import { Router } from "express";
import { Role } from "@prisma/client";
import { authMiddleware, requireRole, requireVerifiedEmail } from "../middleware/auth.middleware.js";
import * as goalController from "../controllers/goal.controller.js";

/**
 * Employee self-service (own goals, own analytics) is not tied to the employer's plan: employees have
 * no subscription and cannot buy one. Manager-side features (team goal progress, setting a staff
 * member's goal, business analytics, CSV export) keep their business plan checks unchanged.
 */
const router = Router();

router.get("/", authMiddleware, requireVerifiedEmail, requireRole(Role.EMPLOYEE), goalController.listMyGoals);
router.post("/", authMiddleware, requireVerifiedEmail, requireRole(Role.EMPLOYEE), goalController.createMyGoal);
router.put(
  "/:goalId",
  authMiddleware,
  requireVerifiedEmail,
  requireRole(Role.EMPLOYEE),
  goalController.updateMyGoal
);
router.post(
  "/:goalId/archive",
  authMiddleware,
  requireVerifiedEmail,
  requireRole(Role.EMPLOYEE),
  goalController.archiveMyGoal
);
router.delete(
  "/:goalId",
  authMiddleware,
  requireVerifiedEmail,
  requireRole(Role.EMPLOYEE),
  goalController.deleteMyGoalById
);

export default router;

