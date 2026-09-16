import { Router } from "express";
import * as legalController from "../controllers/legal.controller.js";
import {
  extractLegalWebhookXmlBody,
  legalWebhookBodyParser,
} from "../middleware/legalWebhookBody.middleware.js";
import { legalWebhookJsonAuth } from "../middleware/legalWebhookJsonAuth.middleware.js";
import { authMiddleware } from "../middleware/auth.middleware.js";
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
/** Public CareTip-controlled PDFs (identical for all merchants). */
router.get("/controlled", legalController.listCareTipControlledLegalDocuments);
/** Fixed PDF paths — inject docId because these routes have no `:docId` param. */
function serveControlledPdf(docId: string): RequestHandler {
  return (req, res, next) => {
    Object.assign(req.params, { docId });
    void legalController.getCareTipControlledPdf(req, res, next);
  };
}
router.get("/avv.pdf", serveControlledPdf("avv"));
router.get("/dpa.pdf", serveControlledPdf("avv"));
router.get("/plv.pdf", serveControlledPdf("plv"));
router.get(
  "/merchant-acceptance-status",
  authMiddleware,
  legalController.getMerchantLegalAcceptanceStatus,
);
router.post("/webhook", legalWebhookBodyParser, legalWebhookAuthGate, legalController.postLegalWebhook);

export default router;
