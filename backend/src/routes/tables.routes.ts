import { Router } from "express";
import { Role } from "@prisma/client";
import { authMiddleware, requireRole, requireVerifiedEmail } from "../middleware/auth.middleware.js";
import * as tablesController from "../controllers/tables.controller.js";
import { requireFeature } from "../services/subscriptionEntitlement.service.js";

const router = Router();

router.get(
  "/",
  authMiddleware,
  requireVerifiedEmail,
  requireRole(Role.MANAGER),
  tablesController.listTables,
);
router.post(
  "/",
  authMiddleware,
  requireVerifiedEmail,
  requireRole(Role.MANAGER),
  requireFeature("tableQr"),
  tablesController.createTable,
);

export default router;
