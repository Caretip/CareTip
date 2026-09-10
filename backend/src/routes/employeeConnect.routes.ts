import { Router } from "express";
import { Role } from "@prisma/client";
import { authMiddleware, requireRole, requireVerifiedEmail } from "../middleware/auth.middleware.js";
import * as employeeConnectController from "../controllers/employeeConnect.controller.js";

const router = Router();

const employeeConnect = [
  authMiddleware,
  requireVerifiedEmail,
  requireRole(Role.EMPLOYEE),
] as const;

router.get("/employee-connect/status", ...employeeConnect, employeeConnectController.getMyEmployeeConnectStatus);
router.get(
  "/employee-connect/payables",
  ...employeeConnect,
  employeeConnectController.getMyEmployeePayableActivity,
);
router.post(
  "/employee-connect/account-link",
  ...employeeConnect,
  employeeConnectController.postMyEmployeeConnectAccountLink,
);
router.post(
  "/employee-connect/login-link",
  ...employeeConnect,
  employeeConnectController.postMyEmployeeConnectLoginLink,
);
router.get(
  "/employee-connect/instant-payout",
  ...employeeConnect,
  employeeConnectController.getMyEmployeeInstantPayout,
);
router.post(
  "/employee-connect/instant-payout",
  ...employeeConnect,
  employeeConnectController.postMyEmployeeInstantPayout,
);
router.get(
  "/employee-connect/stripe-payouts",
  ...employeeConnect,
  employeeConnectController.getMyEmployeeStripeBankPayouts,
);

export default router;
