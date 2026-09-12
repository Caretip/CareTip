import type { Request, Response } from "express";
import * as businessService from "../services/business.service.js";
import { listEmployeeStripeConnectionsForBusiness } from "../services/employeeStripeConnections.service.js";
import { clientSafeMessage, CLIENT_FALLBACK, logServerError } from "../utils/httpErrors.js";

function getUserId(req: Request): string | null {
  const uid = req.user?.userId ?? req.user?.id;
  return typeof uid === "string" && uid.trim() ? uid.trim() : null;
}

function rejectClientSteering(req: Request, res: Response): boolean {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const query = (req.query ?? {}) as Record<string, unknown>;
  if (
    body.businessId != null ||
    body.employeeId != null ||
    body.stripeAccountId != null ||
    body.accountId != null ||
    query.businessId != null ||
    query.employeeId != null ||
    query.stripeAccountId != null ||
    query.accountId != null
  ) {
    res.status(400).json({
      message: "Invalid request.",
      code: "CONNECT_CLIENT_ACCOUNT_FORBIDDEN",
    });
    return true;
  }
  return false;
}

export async function getMyEmployeeStripeConnections(req: Request, res: Response) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Authentication required" });
    if (rejectClientSteering(req, res)) return;
    const business = await businessService.getBusinessByUserId(userId);
    if (!business) return res.status(404).json({ message: "Business not found" });
    const payload = await listEmployeeStripeConnectionsForBusiness(business.id);
    return res.json(payload);
  } catch (err) {
    logServerError("employeeStripeConnections.get", err);
    return res.status(400).json({ message: clientSafeMessage(err, CLIENT_FALLBACK.generic) });
  }
}
