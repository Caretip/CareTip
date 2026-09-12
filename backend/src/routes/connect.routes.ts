import { Router } from "express";
import { Role } from "@prisma/client";
import { authMiddleware, requireRole, requireVerifiedEmail } from "../middleware/auth.middleware.js";
import { requireCompletedOnboarding } from "../middleware/requireCompletedOnboarding.middleware.js";
import * as connectController from "../controllers/connect.controller.js";
import * as employeeTipPayoutModeController from "../controllers/employeeTipPayoutMode.controller.js";
import * as employeeStripeConnectionsController from "../controllers/employeeStripeConnections.controller.js";

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
router.get("/connect/payouts/summary", ...managerConnect, connectController.getMyConnectPayoutSummary);
router.get("/connect/payouts", ...managerConnect, connectController.listMyConnectPayouts);
router.get("/connect/payouts/:id", ...managerConnect, connectController.getMyConnectPayout);
router.get("/connect/instant-payout", ...managerConnect, connectController.getMyInstantPayoutEligibility);
router.post("/connect/instant-payout", ...managerConnect, connectController.postMyInstantPayout);
router.get(
  "/connect/employee-tip-payout-mode",
  ...managerConnect,
  employeeTipPayoutModeController.getMyEmployeeTipPayoutMode,
);
router.get(
  "/connect/employee-tip-routing-overview",
  ...managerConnect,
  employeeTipPayoutModeController.getMyEmployeeTipRoutingOverview,
);
router.patch(
  "/connect/employee-tip-payout-mode",
  ...managerConnect,
  employeeTipPayoutModeController.patchMyEmployeeTipPayoutMode,
);
router.get(
  "/connect/employee-stripe-connections",
  ...managerConnect,
  employeeStripeConnectionsController.getMyEmployeeStripeConnections,
);

export default router;
