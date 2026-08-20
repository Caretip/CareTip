import { Router } from "express";
import { authMiddleware, requireVerifiedEmail } from "../middleware/auth.middleware.js";
import * as notificationsController from "../controllers/notifications.controller.js";
import * as setupNotificationController from "../controllers/setupNotification.controller.js";

const router = Router();

router.get("/", authMiddleware, requireVerifiedEmail, notificationsController.listMine);
router.get("/unread-count", authMiddleware, requireVerifiedEmail, notificationsController.unreadCount);
router.post("/read-all", authMiddleware, requireVerifiedEmail, notificationsController.markAllRead);

// Class S setup intelligence — must be registered before /:id routes
router.post(
  "/setup/evaluate",
  authMiddleware,
  requireVerifiedEmail,
  setupNotificationController.evaluateSetup,
);
router.post(
  "/setup/dismiss",
  authMiddleware,
  requireVerifiedEmail,
  setupNotificationController.dismissSetup,
);
router.post(
  "/setup/actioned",
  authMiddleware,
  requireVerifiedEmail,
  setupNotificationController.actionSetup,
);

router.patch("/:id/read", authMiddleware, requireVerifiedEmail, notificationsController.markRead);
router.delete("/:id", authMiddleware, requireVerifiedEmail, notificationsController.deleteOne);

export default router;
