import { Router } from "express";
import { sharedRateLimit } from "../middleware/sharedRateLimit.middleware.js";
import { resolveClientIp } from "../lib/clientIp.js";
import { authMiddleware, requireVerifiedEmail } from "../middleware/auth.middleware.js";
import * as pushController from "../controllers/push.controller.js";

const router = Router();

const pushTokenLimiter = sharedRateLimit({
  scope: "push-token",
  windowMs: 60 * 60 * 1000,
  max: process.env.NODE_ENV === "production" ? 40 : 200,
  key: (req) => {
    const uid = req.user?.userId ?? req.user?.id;
    return typeof uid === "string" && uid.trim() ? `user:${uid.trim()}` : `ip:${resolveClientIp(req)}`;
  },
  message: "Too many push registration attempts. Try again later.",
});

const pushTestLimiter = sharedRateLimit({
  scope: "push-test",
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: "Too many test notifications. Try again later.",
});

router.get("/config", pushController.getPushConfig);
router.post("/tokens", authMiddleware, requireVerifiedEmail, pushTokenLimiter, pushController.registerToken);
router.delete("/tokens", authMiddleware, requireVerifiedEmail, pushController.deleteToken);
router.delete("/tokens/all", authMiddleware, requireVerifiedEmail, pushController.deleteAllTokens);
router.post("/test", authMiddleware, requireVerifiedEmail, pushTestLimiter, pushController.sendTestNotification);

export default router;
