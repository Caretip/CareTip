import type { RequestHandler } from "express";
import {
  logLegalWebhookAuthFailure,
  logLegalWebhookIncoming,
} from "../utils/legalWebhookLogging.js";

/**
 * Bearer token auth for legal provider webhooks.
 * Set LEGAL_PROVIDER_TOKEN in backend env; provider sends `Authorization: Bearer <token>`.
 */
export const legalWebhookAuth: RequestHandler = (req, res, next) => {
  logLegalWebhookIncoming(req);

  const expected = process.env.LEGAL_PROVIDER_TOKEN?.trim();
  if (!expected) {
    logLegalWebhookAuthFailure("LEGAL_PROVIDER_TOKEN not configured", req);
    res.status(503).json({ message: "Legal webhook is not configured." });
    return;
  }

  const header = req.get("authorization")?.trim() ?? "";
  if (!header) {
    logLegalWebhookAuthFailure("Missing Authorization header", req);
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const match = /^Bearer\s+(.+)$/i.exec(header);
  const token = match?.[1]?.trim();

  if (!token || token !== expected) {
    logLegalWebhookAuthFailure("Invalid Bearer token", req);
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  next();
};
