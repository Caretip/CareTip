import type { Request, Response } from "express";
import * as businessService from "../services/business.service.js";
import { prisma } from "../prisma.js";
import {
  createExpressAccountOnboardingLink,
  getConnectStatusForBusiness,
  refreshConnectStatusFromStripe,
  StripeConnectError,
} from "../services/stripeConnect.service.js";
import {
  getPayoutForBusiness,
  listPayoutsForBusiness,
} from "../services/stripeConnectPayout.service.js";
import { parseBoundedSkip } from "../utils/paginationLimits.js";
import { clientSafeMessage, CLIENT_FALLBACK, logServerError } from "../utils/httpErrors.js";

function getUserId(req: Request): string | null {
  const uid = req.user?.userId ?? req.user?.id;
  return typeof uid === "string" && uid.trim() ? uid.trim() : null;
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

    // Explicitly reject client attempts to steer tenancy or account id.
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (body.businessId != null || body.stripeAccountId != null || body.accountId != null) {
      return res.status(400).json({
        message: "Invalid request.",
        code: "CONNECT_CLIENT_ACCOUNT_FORBIDDEN",
      });
    }
    if (body.returnUrl != null || body.refreshUrl != null || body.country != null) {
      return res.status(400).json({
        message: "Invalid request.",
        code: "CONNECT_CLIENT_URL_FORBIDDEN",
      });
    }

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
 * GET /api/me/connect/payouts
 * Business is derived from JWT only. Query businessId is ignored.
 */
export async function listMyConnectPayouts(req: Request, res: Response) {
  try {
    const ctx = await resolveManagerBusiness(req);
    if (!ctx.ok) return res.status(ctx.status).json({ message: ctx.message });

    const take = Math.min(Math.max(Number(req.query.take) || 50, 1), 100);
    const skip = parseBoundedSkip(req.query.skip);
    const result = await listPayoutsForBusiness(ctx.businessId, { take, skip });
    return res.json(result);
  } catch (err) {
    logServerError("connect.listMyConnectPayouts", err);
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
