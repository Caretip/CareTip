import { Router } from "express";
import * as legalController from "../controllers/legal.controller.js";
import { legalWebhookAuth } from "../middleware/legalWebhookAuth.middleware.js";

const router = Router();

router.get("/privacy", legalController.getPrivacyDocument);
router.get("/terms", legalController.getTermsDocument);
router.get("/impressum", legalController.getImpressumDocument);
router.post("/webhook", legalWebhookAuth, legalController.postLegalWebhook);

export default router;
