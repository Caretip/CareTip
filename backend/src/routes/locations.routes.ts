import { Router } from "express";
import { Role } from "@prisma/client";
import { authMiddleware, requireRole, requireVerifiedEmail } from "../middleware/auth.middleware.js";
import * as locationsController from "../controllers/locations.controller.js";
import { requireOperationalSubscription } from "../services/subscriptionEntitlement.service.js";

const router = Router();

router.get(
  "/",
  authMiddleware,
  requireVerifiedEmail,
  requireRole(Role.MANAGER),
  locationsController.listLocations,
);
router.post(
  "/",
  authMiddleware,
  requireVerifiedEmail,
  requireRole(Role.MANAGER),
  requireOperationalSubscription(),
  locationsController.createLocation,
);
router.patch(
  "/:id",
  authMiddleware,
  requireVerifiedEmail,
  requireRole(Role.MANAGER),
  locationsController.updateLocation,
);
router.delete(
  "/:id",
  authMiddleware,
  requireVerifiedEmail,
  requireRole(Role.MANAGER),
  locationsController.deleteLocation,
);

export default router;
