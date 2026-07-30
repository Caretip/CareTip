import { Router } from "express";
import * as legalController from "../controllers/legal.controller.js";
import {
  extractLegalWebhookXmlBody,
  legalWebhookBodyParser,
} from "../middleware/legalWebhookBody.middleware.js";
import { legalWebhookJsonAuth } from "../middleware/legalWebhookJsonAuth.middleware.js";
import type { RequestHandler } from "express";

const router = Router();

/** JSON legacy webhooks use header Bearer auth; IT-Recht XML authenticates in the XML body. */
const legalWebhookAuthGate: RequestHandler = (req, res, next) => {
  if (extractLegalWebhookXmlBody(req)) {
    next();
    return;
  }
  legalWebhookJsonAuth(req, res, next);
};

router.get("/privacy", legalController.getPrivacyDocument);
router.get("/terms", legalController.getTermsDocument);
router.get("/impressum", legalController.getImpressumDocument);
router.post("/webhook", legalWebhookBodyParser, legalWebhookAuthGate, legalController.postLegalWebhook);

export default router;
