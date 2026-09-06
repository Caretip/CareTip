import { Router } from "express";
import { Role } from "@prisma/client";
import { authMiddleware, requireRole, requireVerifiedEmail } from "../middleware/auth.middleware.js";
import { requireCompletedOnboarding } from "../middleware/requireCompletedOnboarding.middleware.js";
import * as connectController from "../controllers/connect.controller.js";

const router = Router();

const managerConnect = [
  authMiddleware,
  requireVerifiedEmail,
  requireRole(Role.MANAGER),
  requireCompletedOnboarding,
] as const;

router.get("/connect/status", ...managerConnect, connectController.getMyConnectStatus);
router.post("/connect/account-link", ...managerConnect, connectController.postMyConnectAccountLink);
router.post("/connect/login-link", ...managerConnect, connectController.postMyConnectLoginLink);
router.get("/connect/payouts", ...managerConnect, connectController.listMyConnectPayouts);
router.get("/connect/payouts/:id", ...managerConnect, connectController.getMyConnectPayout);

export default router;
