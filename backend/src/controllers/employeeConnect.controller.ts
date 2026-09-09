import type { Request, Response } from "express";
import {
  StripeConnectError,
} from "../services/stripeConnect.service.js";
import {
  createEmployeeConnectAccountLink,
  createEmployeeConnectLoginLink,
  getEmployeeConnectStatusForUser,
  refreshEmployeeConnectStatusFromStripe,
} from "../services/employeeStripeConnect.service.js";
import { clientSafeMessage, CLIENT_FALLBACK, logServerError } from "../utils/httpErrors.js";

function getUserId(req: Request): string | null {
  const uid = req.user?.userId ?? req.user?.id;
  return typeof uid === "string" && uid.trim() ? uid.trim() : null;
}

function connectClientMessage(err: unknown): string {
  if (err instanceof StripeConnectError) return err.message;
  return clientSafeMessage(err, CLIENT_FALLBACK.generic);
}

/** Reject client-steered tenancy, account ids, and redirect URLs. */
function rejectClientEmployeeConnectSteering(req: Request, res: Response): boolean {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const query = (req.query ?? {}) as Record<string, unknown>;
  if (
    body.businessId != null ||
    body.employeeId != null ||
    body.stripeAccountId != null ||
    body.accountId != null ||
    body.destination != null ||
    body.amount != null ||
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
  if (
    body.returnUrl != null ||
    body.refreshUrl != null ||
    body.country != null ||
    body.redirectUrl != null ||
    query.returnUrl != null ||
    query.refreshUrl != null ||
    query.redirectUrl != null
  ) {
    res.status(400).json({
      message: "Invalid request.",
      code: "CONNECT_CLIENT_URL_FORBIDDEN",
    });
    return true;
  }
  return false;
}

export async function getMyEmployeeConnectStatus(req: Request, res: Response) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Authentication required" });
    if (rejectClientEmployeeConnectSteering(req, res)) return;

    try {
      await refreshEmployeeConnectStatusFromStripe(userId);
    } catch (err) {
      logServerError("employeeConnect.refresh", err, { userId });
    }
    const status = await getEmployeeConnectStatusForUser(userId);
    return res.json(status);
  } catch (err) {
    logServerError("employeeConnect.getMyEmployeeConnectStatus", err);
    if (err instanceof StripeConnectError) {
      return res.status(err.httpStatus).json({ message: err.message, code: err.code });
    }
    return res.status(400).json({ message: connectClientMessage(err) });
  }
}

export async function postMyEmployeeConnectAccountLink(req: Request, res: Response) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Authentication required" });
    if (rejectClientEmployeeConnectSteering(req, res)) return;

    const result = await createEmployeeConnectAccountLink(userId);
    return res.json({ url: result.url });
  } catch (err) {
    logServerError("employeeConnect.postMyEmployeeConnectAccountLink", err);
    if (err instanceof StripeConnectError) {
      return res.status(err.httpStatus).json({ message: err.message, code: err.code });
    }
    return res.status(400).json({ message: connectClientMessage(err) });
  }
}

export async function postMyEmployeeConnectLoginLink(req: Request, res: Response) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Authentication required" });
    if (rejectClientEmployeeConnectSteering(req, res)) return;

    const result = await createEmployeeConnectLoginLink(userId);
    return res.json({ url: result.url });
  } catch (err) {
    logServerError("employeeConnect.postMyEmployeeConnectLoginLink", err);
    if (err instanceof StripeConnectError) {
      return res.status(err.httpStatus).json({ message: err.message, code: err.code });
    }
    return res.status(400).json({ message: connectClientMessage(err) });
  }
}
