import type { RequestHandler } from "express";
import {
  logLegalWebhookAuthFailure,
  logLegalWebhookIncoming,
} from "../utils/legalWebhookLogging.js";
// TODO: Remove after IT-Recht Kanzlei integration is verified.
import {
  logLegalWebhookAuthFailureDebug,
  logLegalWebhookAuthSuccess,
  logLegalWebhookDebugIncoming,
  resolveLegalWebhookAuth,
} from "../utils/legalWebhookAuthDebug.js";

/**
 * Bearer token auth for legal provider webhooks.
 * Set LEGAL_PROVIDER_TOKEN in backend env; provider sends `Authorization: Bearer <token>`.
 *
 * TODO: Remove after IT-Recht Kanzlei integration is verified.
 * Temporarily accepts Authorization (Bearer/raw), X-API-Key, and X-Auth-Token for debugging.
 */
export const legalWebhookAuth: RequestHandler = (req, res, next) => {
  logLegalWebhookIncoming(req);
  // TODO: Remove after IT-Recht Kanzlei integration is verified.
  logLegalWebhookDebugIncoming(req);

  const expected = process.env.LEGAL_PROVIDER_TOKEN?.trim();
  if (!expected) {
    logLegalWebhookAuthFailure("LEGAL_PROVIDER_TOKEN not configured", req);
    res.status(503).json({ message: "Legal webhook is not configured." });
    return;
  }

  // TODO: Remove after IT-Recht Kanzlei integration is verified.
  const authResult = resolveLegalWebhookAuth(req, expected);
  if (!authResult.ok) {
    logLegalWebhookAuthFailureDebug(req, authResult.reason, authResult.attempts);
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  logLegalWebhookAuthSuccess(req, authResult.method);
  next();
};
