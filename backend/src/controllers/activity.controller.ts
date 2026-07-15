import type { Request, Response } from "express";
import { ActivityEventSource } from "@prisma/client";
import * as businessService from "../services/business.service.js";
import { listBusinessActivityEvents } from "../services/activity/businessActivityEvent.service.js";
import { clientSafeMessage, logServerError } from "../utils/httpErrors.js";

const SOURCE_VALUES = new Set<string>(Object.values(ActivityEventSource));

/**
 * GET /api/business/activity
 * Feed from BusinessActivityEvent only — no aggregates, no domain-table joins.
 */
export async function listActivity(req: Request, res: Response) {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const business = await businessService.getBusinessByUserId(userId);
    if (!business) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }

    const sourceRaw =
      typeof req.query.source === "string" ? req.query.source.trim().toUpperCase() : "ALL";
    let source: ActivityEventSource | "all" = "all";
    if (sourceRaw && sourceRaw !== "ALL") {
      if (!SOURCE_VALUES.has(sourceRaw)) {
        return res.status(400).json({
          message: "Invalid source filter. Use TIPS|QR|GOALS|STAFF|PAYMENTS|SYSTEM|all",
        });
      }
      source = sourceRaw as ActivityEventSource;
    }

    const limit = Number(req.query.limit);
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;

    try {
      const result = await listBusinessActivityEvents(business.id, {
        limit: Number.isFinite(limit) ? limit : 30,
        cursor,
        source,
      });
      return res.json(result);
    } catch (err) {
      if (
        err instanceof Error &&
        (err as Error & { statusCode?: number }).statusCode === 400
      ) {
        return res.status(400).json({ message: err.message });
      }
      throw err;
    }
  } catch (err) {
    logServerError("activity.listActivity", err);
    return res.status(500).json({
      message: clientSafeMessage(err, "We couldn't load activity. Try again."),
    });
  }
}
