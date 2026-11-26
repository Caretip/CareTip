import { Router } from "express";
import * as paymentController from "../controllers/payment.controller.js";
import { publicTipCheckoutLimiter, tipSessionLookupLimiter } from "../middleware/rateLimit.middleware.js";

const router = Router();

router.post("/create-tip-session", publicTipCheckoutLimiter, paymentController.createTipSession);
router.get("/tip-session/:sessionId", tipSessionLookupLimiter, paymentController.getTipSessionContext);

export default router;
