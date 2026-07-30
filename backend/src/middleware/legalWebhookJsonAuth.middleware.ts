import type { RequestHandler } from "express";
import { logLegalWebhookJsonAuthFailure } from "../utils/legalWebhookLogging.js";

/**
 * Legacy JSON webhook auth — Bearer token in Authorization header only.
 * IT-Recht Kanzlei XML requests authenticate via user_auth_token in the XML body instead.
 */
export const legalWebhookJsonAuth: RequestHandler = (req, res, next) => {
  const expected = process.env.LEGAL_PROVIDER_TOKEN?.trim();
  if (!expected) {
    logLegalWebhookJsonAuthFailure("LEGAL_PROVIDER_TOKEN not configured", req);
    res.status(503).json({ message: "Legal webhook is not configured." });
    return;
  }

  const header = req.get("authorization")?.trim() ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const token = match?.[1]?.trim();

  if (!token || token !== expected) {
    logLegalWebhookJsonAuthFailure(
      header ? "Invalid Bearer token" : "Missing Authorization header",
      req,
    );
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  next();
};
