import { Router } from "express";
import * as legalController from "../controllers/legal.controller.js";
import {
  extractLegalWebhookXmlBody,
  legalWebhookBodyParser,
} from "../middleware/legalWebhookBody.middleware.js";
import { legalWebhookJsonAuth } from "../middleware/legalWebhookJsonAuth.middleware.js";
import { authMiddleware } from "../middleware/auth.middleware.js";
import type { RequestHandler } from "express";
import { sharedRateLimit } from "../middleware/sharedRateLimit.middleware.js";

/**
 * IT-Recht Kanzlei pushes a handful of documents when texts change, from a few addresses. Its XML
 * may carry PDFs (hence the 15 MB body), and authentication sits inside that XML, so the body must
 * be read before it can be rejected. This limit runs before the body is read.
 */
const legalWebhookLimiter = sharedRateLimit({
  scope: "legal-webhook",
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: "Too many requests.",
});

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
router.post("/webhook", legalWebhookLimiter, legalWebhookBodyParser, legalWebhookAuthGate, legalController.postLegalWebhook);

export default router;
