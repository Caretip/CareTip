import type { Request, Response } from "express";
import { EmployeeTipPayoutMode } from "@prisma/client";
import * as businessService from "../services/business.service.js";
import { prisma } from "../prisma.js";
import {
  employeeTipHoldObservabilityForBusiness,
  routingModeFromClient,
} from "../services/employeeTipPayable.service.js";
import { writeAuditLog } from "../services/audit.service.js";
import { clientSafeMessage, CLIENT_FALLBACK, logServerError } from "../utils/httpErrors.js";

function getUserId(req: Request): string | null {
  const uid = req.user?.userId ?? req.user?.id;
  return typeof uid === "string" && uid.trim() ? uid.trim() : null;
}

function rejectClientRoutingSteering(req: Request, res: Response): boolean {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const query = (req.query ?? {}) as Record<string, unknown>;
  if (
    body.businessId != null ||
    body.employeeId != null ||
    body.stripeAccountId != null ||
    body.destination != null ||
    query.businessId != null
  ) {
    res.status(400).json({
      message: "Invalid request.",
      code: "CONNECT_CLIENT_ACCOUNT_FORBIDDEN",
    });
    return true;
  }
  return false;
}

export async function getMyEmployeeTipPayoutMode(req: Request, res: Response) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Authentication required" });
    if (rejectClientRoutingSteering(req, res)) return;
    const business = await businessService.getBusinessByUserId(userId);
    if (!business) return res.status(404).json({ message: "Business not found" });
    const row = await prisma.business.findUnique({
      where: { id: business.id },
      select: { employeeTipPayoutMode: true },
    });
    return res.json({
      mode: row?.employeeTipPayoutMode ?? EmployeeTipPayoutMode.direct_to_employee,
    });
  } catch (err) {
    logServerError("employeeTipPayoutMode.get", err);
    return res.status(400).json({ message: clientSafeMessage(err, CLIENT_FALLBACK.generic) });
  }
}

/**
 * GET /api/me/connect/employee-tip-routing-overview
 * Current routing mode plus remaining CareTip platform-hold amounts (ledger, not Stripe payouts).
 */
export async function getMyEmployeeTipRoutingOverview(req: Request, res: Response) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Authentication required" });
    if (rejectClientRoutingSteering(req, res)) return;
    const business = await businessService.getBusinessByUserId(userId);
    if (!business) return res.status(404).json({ message: "Business not found" });
    const [row, holds] = await Promise.all([
      prisma.business.findUnique({
        where: { id: business.id },
        select: { employeeTipPayoutMode: true },
      }),
      employeeTipHoldObservabilityForBusiness(business.id),
    ]);
    return res.json({
      mode: row?.employeeTipPayoutMode ?? EmployeeTipPayoutMode.direct_to_employee,
      heldPlatformCents: holds.heldPlatformCents,
      heldRowCount: holds.heldRowCount,
    });
  } catch (err) {
    logServerError("employeeTipPayoutMode.overview", err);
    return res.status(400).json({ message: clientSafeMessage(err, CLIENT_FALLBACK.generic) });
  }
}

export async function patchMyEmployeeTipPayoutMode(req: Request, res: Response) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Authentication required" });
    if (rejectClientRoutingSteering(req, res)) return;
    const mode = routingModeFromClient((req.body as { mode?: unknown })?.mode);
    if (!mode) {
      return res.status(400).json({ message: "Invalid payout mode.", code: "INVALID_PAYOUT_MODE" });
    }
    const business = await businessService.getBusinessByUserId(userId);
    if (!business) return res.status(404).json({ message: "Business not found" });

    const updated = await prisma.business.update({
      where: { id: business.id },
      data: { employeeTipPayoutMode: mode },
      select: { employeeTipPayoutMode: true },
    });
    await writeAuditLog({
      userId,
      action: "business.employee_tip_payout_mode.updated",
      metadata: JSON.stringify({
        businessId: business.id,
        mode: updated.employeeTipPayoutMode,
      }),
    });
    return res.json({ mode: updated.employeeTipPayoutMode });
  } catch (err) {
    logServerError("employeeTipPayoutMode.patch", err);
    return res.status(400).json({ message: clientSafeMessage(err, CLIENT_FALLBACK.generic) });
  }
}
