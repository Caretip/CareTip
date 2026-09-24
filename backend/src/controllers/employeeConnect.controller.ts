import type { Request, Response } from "express";
import {
  StripeConnectError,
} from "../services/stripeConnect.service.js";
import {
  createEmployeeConnectAccountLink,
  createEmployeeConnectLoginLink,
  getEmployeeConnectStatusForUser,
  refreshEmployeeConnectStatusFromStripe,
  resolveActiveEmployeeForConnect,
} from "../services/employeeStripeConnect.service.js";
import { listEmployeePayableActivityForEmployee } from "../services/employeeTipPayable.service.js";
import {
  createEmployeeInstantPayoutForUser,
  getEmployeeInstantPayoutEligibilityForUser,
} from "../services/employeeInstantPayout.service.js";
import { listEmployeeStripeBankPayoutsForUser } from "../services/employeeStripeBankPayouts.service.js";
import {
  loadEmployeeAnalyticsForUser,
  type EmployeeAnalyticsPeriod,
} from "../services/employeeAnalytics.service.js";
import { clientSafeMessage, CLIENT_FALLBACK, logServerError } from "../utils/httpErrors.js";
import {
  INSTANT_PAYOUT_TERMS_CONTEXT_EMPLOYEE,
  languageFromRequest,
  withInstantPayoutTerms,
} from "../lib/instantPayoutTerms.js";

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
    body.fee != null ||
    body.feeBps != null ||
    body.application_fee_amount != null ||
    query.businessId != null ||
    query.employeeId != null ||
    query.stripeAccountId != null ||
    query.accountId != null ||
    query.destination != null ||
    query.amount != null ||
    query.fee != null
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
    if (status.connectionState === "connected" && status.heldPlatformCents > 0) {
      const actor = await resolveActiveEmployeeForConnect(userId);
      const { scheduleReleaseRecoverablePlatformPayablesForEmployee } = await import(
        "../services/employeeTipRelease.service.js"
      );
      scheduleReleaseRecoverablePlatformPayablesForEmployee(actor.employeeId);
    }
    return res.json(status);
  } catch (err) {
    logServerError("employeeConnect.getMyEmployeeConnectStatus", err);
    if (err instanceof StripeConnectError) {
      return res.status(err.httpStatus).json({ message: err.message, code: err.code });
    }
    return res.status(400).json({ message: connectClientMessage(err) });
  }
}

export async function getMyEmployeePayableActivity(req: Request, res: Response) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Authentication required" });
    if (rejectClientEmployeeConnectSteering(req, res)) return;

    const actor = await resolveActiveEmployeeForConnect(userId);
    const { scheduleReleaseRecoverablePlatformPayablesForEmployee } = await import(
      "../services/employeeTipRelease.service.js"
    );
    scheduleReleaseRecoverablePlatformPayablesForEmployee(actor.employeeId);
    const takeRaw = Number(req.query.take);
    const skipRaw = Number(req.query.skip);
    const take = Number.isInteger(takeRaw) ? takeRaw : 20;
    const skip = Number.isInteger(skipRaw) ? skipRaw : 0;
    const filterRaw = typeof req.query.filter === "string" ? req.query.filter.trim() : "";
    const filter =
      filterRaw === "tips" ||
      filterRaw === "transfers" ||
      filterRaw === "pending" ||
      filterRaw === "issues"
        ? filterRaw
        : "all";
    const result = await listEmployeePayableActivityForEmployee(actor.employeeId, {
      take,
      skip,
      filter,
    });
    return res.json(result);
  } catch (err) {
    logServerError("employeeConnect.getMyEmployeePayableActivity", err);
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

export async function getMyEmployeeInstantPayout(req: Request, res: Response) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Authentication required" });
    if (rejectClientEmployeeConnectSteering(req, res)) return;
    const eligibility = await getEmployeeInstantPayoutEligibilityForUser(userId);
    return res.json(
      await withInstantPayoutTerms(
        eligibility,
        INSTANT_PAYOUT_TERMS_CONTEXT_EMPLOYEE,
        languageFromRequest(req),
      ),
    );
  } catch (err) {
    logServerError("employeeConnect.getMyEmployeeInstantPayout", err);
    if (err instanceof StripeConnectError) {
      return res.status(err.httpStatus).json({ message: err.message, code: err.code });
    }
    return res.status(400).json({ message: connectClientMessage(err) });
  }
}

export async function postMyEmployeeInstantPayout(req: Request, res: Response) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Authentication required" });
    if (rejectClientEmployeeConnectSteering(req, res)) return;
    const body = (req.body ?? {}) as { idempotencyKey?: unknown; termsVersion?: unknown };
    const result = await createEmployeeInstantPayoutForUser({
      userId,
      idempotencyKey: body.idempotencyKey,
      termsVersion: body.termsVersion,
      language: languageFromRequest(req),
    });
    return res.json(result);
  } catch (err) {
    logServerError("employeeConnect.postMyEmployeeInstantPayout", err);
    if (err instanceof StripeConnectError) {
      return res.status(err.httpStatus).json({ message: err.message, code: err.code });
    }
    return res.status(400).json({ message: connectClientMessage(err) });
  }
}

function parseEmployeeAnalyticsPeriod(raw: unknown): EmployeeAnalyticsPeriod {
  const p = typeof raw === "string" ? raw.trim() : "";
  if (p === "today" || p === "week" || p === "month" || p === "year" || p === "all") return p;
  return "month";
}

export async function getMyEmployeeAnalytics(req: Request, res: Response) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Authentication required" });
    if (rejectClientEmployeeConnectSteering(req, res)) return;

    const period = parseEmployeeAnalyticsPeriod(req.query.period);
    const bundle = await loadEmployeeAnalyticsForUser(userId, { period });
    return res.json(bundle);
  } catch (err) {
    logServerError("employeeConnect.getMyEmployeeAnalytics", err);
    if (err instanceof StripeConnectError) {
      return res.status(err.httpStatus).json({ message: err.message, code: err.code });
    }
    return res.status(400).json({ message: connectClientMessage(err) });
  }
}

export async function getMyEmployeeStripeBankPayouts(req: Request, res: Response) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Authentication required" });
    if (rejectClientEmployeeConnectSteering(req, res)) return;
    const takeRaw = Number(req.query.take);
    const take = Number.isInteger(takeRaw) ? takeRaw : 20;
    const result = await listEmployeeStripeBankPayoutsForUser(userId, { take });
    return res.json(result);
  } catch (err) {
    logServerError("employeeConnect.getMyEmployeeStripeBankPayouts", err);
    if (err instanceof StripeConnectError) {
      return res.status(err.httpStatus).json({ message: err.message, code: err.code });
    }
    return res.status(400).json({ message: connectClientMessage(err) });
  }
}
