import type { RequestHandler } from "express";

/**
 * Bearer token auth for legal provider webhooks.
 * Set LEGAL_PROVIDER_TOKEN in backend env; provider sends `Authorization: Bearer <token>`.
 */
export const legalWebhookAuth: RequestHandler = (req, res, next) => {
  const expected = process.env.LEGAL_PROVIDER_TOKEN?.trim();
  if (!expected) {
    console.error("[legal.webhook] LEGAL_PROVIDER_TOKEN is not configured");
    res.status(503).json({ message: "Legal webhook is not configured." });
    return;
  }

  const header = req.get("authorization")?.trim() ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const token = match?.[1]?.trim();

  if (!token || token !== expected) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  next();
};
