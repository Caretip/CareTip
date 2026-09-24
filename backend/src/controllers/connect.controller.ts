import type { Request, Response } from "express";
import { resolveRequestUserId } from "../middleware/auth.middleware.js";
import * as businessService from "../services/business.service.js";
import { prisma } from "../prisma.js";
import {
  createExpressAccountOnboardingLink,
  createExpressDashboardLoginLink,
  getConnectStatusForBusiness,
  refreshConnectStatusFromStripe,
  StripeConnectError,
} from "../services/stripeConnect.service.js";
import {
  getPayoutForBusiness,
  listPayoutsForBusiness,
  summarizePayoutsForBusiness,
} from "../services/stripeConnectPayout.service.js";
import {
  createInstantPayoutForBusiness,
  getInstantPayoutEligibilityForBusiness,
} from "../services/stripeConnectInstantPayout.service.js";
import { loadBusinessFinancialSummaryForBusiness } from "../services/businessFinancialSummary.service.js";
import type { BusinessTimeframe } from "../utils/businessTime.js";
import { parseBoundedSkip } from "../utils/paginationLimits.js";
import { clientSafeMessage, CLIENT_FALLBACK, logServerError } from "../utils/httpErrors.js";
import {
  INSTANT_PAYOUT_TERMS_CONTEXT_BUSINESS,
  languageFromRequest,
  withInstantPayoutTerms,
} from "../lib/instantPayoutTerms.js";

function getUserId(req: Request): string | null {
  return resolveRequestUserId(req);
}

type ManagerBusinessContext =
  | {
      ok: true;
      userId: string;
      businessId: string;
      email: string;
    }
  | { ok: false; status: number; message: string };

/**
 * Resolve the manager's Business from JWT userId only.
 * Never trusts req.body.businessId / stripeAccountId.
 */
async function resolveManagerBusiness(req: Request): Promise<ManagerBusinessContext> {
  const userId = getUserId(req);
  if (!userId) return { ok: false, status: 401, message: "Authentication required" };

  const business = await businessService.getBusinessByUserId(userId);
  if (!business) {
    return { ok: false, status: 404, message: "Business not found" };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  if (!user?.email) {
    return { ok: false, status: 404, message: "User not found" };
  }

  return {
    ok: true,
    userId,
    businessId: business.id,
    email: user.email,
  };
}

function connectClientMessage(err: unknown): string {
  if (err instanceof StripeConnectError) return err.message;
  return clientSafeMessage(err, CLIENT_FALLBACK.generic);
}

/** Reject client-steered tenancy, account ids, and redirect URLs. Uses JWT business only. */
function rejectClientConnectSteering(req: Request, res: Response): boolean {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const query = (req.query ?? {}) as Record<string, unknown>;
  if (
    body.businessId != null ||
    body.stripeAccountId != null ||
    body.accountId != null ||
    query.businessId != null ||
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

/**
 * GET /api/me/connect/status
 */
export async function getMyConnectStatus(req: Request, res: Response) {
  try {
    const ctx = await resolveManagerBusiness(req);
    if (!ctx.ok) return res.status(ctx.status).json({ message: ctx.message });

    try {
      await refreshConnectStatusFromStripe(ctx.businessId);
    } catch (err) {
      logServerError("connect.refreshConnectStatusFromStripe", err, { businessId: ctx.businessId });
    }
    const status = await getConnectStatusForBusiness(ctx.businessId);
    return res.json(status);
  } catch (err) {
    logServerError("connect.getMyConnectStatus", err);
    if (err instanceof StripeConnectError) {
      return res.status(err.httpStatus).json({ message: err.message, code: err.code });
    }
    return res.status(400).json({ message: connectClientMessage(err) });
  }
}

/**
 * POST /api/me/connect/account-link
 * Creates Express account if needed, returns Stripe-hosted onboarding URL.
 */
export async function postMyConnectAccountLink(req: Request, res: Response) {
  try {
    const ctx = await resolveManagerBusiness(req);
    if (!ctx.ok) return res.status(ctx.status).json({ message: ctx.message });
    if (rejectClientConnectSteering(req, res)) return;

    const result = await createExpressAccountOnboardingLink({
      businessId: ctx.businessId,
      managerEmail: ctx.email,
    });

    // Do not return stripeAccountId to the client — status endpoint exposes safe flags only.
    return res.json({ url: result.url });
  } catch (err) {
    logServerError("connect.postMyConnectAccountLink", err);
    if (err instanceof StripeConnectError) {
      return res.status(err.httpStatus).json({ message: err.message, code: err.code });
    }
    return res.status(400).json({ message: connectClientMessage(err) });
  }
}

/**
 * POST /api/me/connect/login-link
 * Express Dashboard Login Link for the manager's stored connected account.
 */
export async function postMyConnectLoginLink(req: Request, res: Response) {
  try {
    const ctx = await resolveManagerBusiness(req);
    if (!ctx.ok) return res.status(ctx.status).json({ message: ctx.message });
    if (rejectClientConnectSteering(req, res)) return;

    const result = await createExpressDashboardLoginLink({ businessId: ctx.businessId });
    return res.json({ url: result.url });
  } catch (err) {
    logServerError("connect.postMyConnectLoginLink", err);
    if (err instanceof StripeConnectError) {
      return res.status(err.httpStatus).json({ message: err.message, code: err.code });
    }
    return res.status(400).json({ message: connectClientMessage(err) });
  }
}

/**
 * GET /api/me/connect/payouts
 * Business is derived from JWT only. Query businessId is ignored.
 */
export async function listMyConnectPayouts(req: Request, res: Response) {
  try {
    const ctx = await resolveManagerBusiness(req);
    if (!ctx.ok) return res.status(ctx.status).json({ message: ctx.message });

    const take = Math.min(Math.max(Number(req.query.take) || 50, 1), 100);
    const skip = parseBoundedSkip(req.query.skip);
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const method = typeof req.query.method === "string" ? req.query.method : undefined;
    const result = await listPayoutsForBusiness(ctx.businessId, { take, skip, q, status, method });
    return res.json(result);
  } catch (err) {
    logServerError("connect.listMyConnectPayouts", err);
    return res.status(400).json({ message: connectClientMessage(err) });
  }
}

function parseBusinessFinancialPeriod(raw: unknown): BusinessTimeframe {
  const p = typeof raw === "string" ? raw.trim() : "";
  if (p === "today" || p === "week" || p === "month" || p === "year" || p === "all") return p;
  return "all";
}

/**
 * GET /api/me/connect/financial-summary
 * CareTip ledger + read-only Stripe balance/payout summary for the JWT business.
 */
export async function getMyBusinessFinancialSummary(req: Request, res: Response) {
  try {
    const ctx = await resolveManagerBusiness(req);
    if (!ctx.ok) return res.status(ctx.status).json({ message: ctx.message });
    if (rejectClientConnectSteering(req, res)) return;

    const period = parseBusinessFinancialPeriod(req.query.period);
    const sectionRaw = typeof req.query.section === "string" ? req.query.section.trim() : "";
    const section =
      sectionRaw === "ledger" || sectionRaw === "connect" || sectionRaw === "reconciliation"
        ? sectionRaw
        : undefined;
    const includeReconciliation = req.query.includeReconciliation === "true";
    const bundle = await loadBusinessFinancialSummaryForBusiness(ctx.businessId, {
      period,
      section,
      includeReconciliation,
    });
    return res.json(bundle);
  } catch (err) {
    logServerError("connect.getMyBusinessFinancialSummary", err);
    return res.status(400).json({ message: connectClientMessage(err) });
  }
}

/**
 * GET /api/me/connect/payouts/summary
 * StripeConnectPayout aggregates for the JWT business. Not a frontend total.
 */
export async function getMyConnectPayoutSummary(req: Request, res: Response) {
  try {
    const ctx = await resolveManagerBusiness(req);
    if (!ctx.ok) return res.status(ctx.status).json({ message: ctx.message });
    const summary = await summarizePayoutsForBusiness(ctx.businessId);
    return res.json(summary);
  } catch (err) {
    logServerError("connect.getMyConnectPayoutSummary", err);
    return res.status(400).json({ message: connectClientMessage(err) });
  }
}

/**
 * GET /api/me/connect/payouts/:id
 */
export async function getMyConnectPayout(req: Request, res: Response) {
  try {
    const ctx = await resolveManagerBusiness(req);
    if (!ctx.ok) return res.status(ctx.status).json({ message: ctx.message });

    const id = typeof req.params.id === "string" ? req.params.id.trim() : "";
    if (!id) return res.status(400).json({ message: "Invalid payout id" });

    const payout = await getPayoutForBusiness(ctx.businessId, id);
    if (!payout) return res.status(404).json({ message: "Payout not found" });
    return res.json(payout);
  } catch (err) {
    logServerError("connect.getMyConnectPayout", err);
    return res.status(400).json({ message: connectClientMessage(err) });
  }
}

function rejectInstantPayoutClientSteering(req: Request, res: Response): boolean {
  if (rejectClientConnectSteering(req, res)) return true;
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (
    body.amount != null ||
    body.amountCents != null ||
    body.currency != null ||
    body.destination != null ||
    body.balance != null ||
    body.fee != null ||
    body.eligible != null
  ) {
    res.status(400).json({
      message: "Invalid request.",
      code: "CONNECT_CLIENT_PAYOUT_STEERING_FORBIDDEN",
    });
    return true;
  }
  return false;
}

/**
 * GET /api/me/connect/instant-payout
 * Stripe-authoritative Instant Payout eligibility for the JWT business.
 */
export async function getMyInstantPayoutEligibility(req: Request, res: Response) {
  try {
    const ctx = await resolveManagerBusiness(req);
    if (!ctx.ok) return res.status(ctx.status).json({ message: ctx.message });

    const eligibility = await getInstantPayoutEligibilityForBusiness(ctx.businessId);
    return res.json(
      await withInstantPayoutTerms(
        eligibility,
        INSTANT_PAYOUT_TERMS_CONTEXT_BUSINESS,
        languageFromRequest(req),
      ),
    );
  } catch (err) {
    logServerError("connect.getMyInstantPayoutEligibility", err);
    if (err instanceof StripeConnectError) {
      return res.status(err.httpStatus).json({ message: err.message, code: err.code });
    }
    return res.status(400).json({ message: connectClientMessage(err) });
  }
}

/**
 * POST /api/me/connect/instant-payout
 * Creates an Instant Payout for the JWT business. Amount/destination from Stripe only.
 */
export async function postMyInstantPayout(req: Request, res: Response) {
  try {
    const ctx = await resolveManagerBusiness(req);
    if (!ctx.ok) return res.status(ctx.status).json({ message: ctx.message });
    if (rejectInstantPayoutClientSteering(req, res)) return;

    const body = req.body as { idempotencyKey?: unknown; termsVersion?: unknown } | undefined;
    const result = await createInstantPayoutForBusiness({
      businessId: ctx.businessId,
      userId: ctx.userId,
      idempotencyKey: body?.idempotencyKey,
      termsVersion: body?.termsVersion,
      language: languageFromRequest(req),
    });
    return res.status(201).json(result);
  } catch (err) {
    logServerError("connect.postMyInstantPayout", err);
    if (err instanceof StripeConnectError) {
      return res.status(err.httpStatus).json({ message: err.message, code: err.code });
    }
    return res.status(400).json({ message: connectClientMessage(err) });
  }
}
