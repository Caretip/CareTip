import type { Request, Response } from "express";
import { resolveRequestUserId } from "../middleware/auth.middleware.js";
import * as businessService from "../services/business.service.js";
import { writeAuditLog } from "../services/audit.service.js";
import { clientSafeMessage, CLIENT_FALLBACK, logServerError } from "../utils/httpErrors.js";
import { parseBoundedSkip } from "../utils/paginationLimits.js";
import {
  createTipDistributionBatch,
  getTipDistributionBatchForBusiness,
  listTipDistributionBatchesForBusiness,
  listTipDistributionEmployeesForBusiness,
  loadTipDistributionSummaryForBusiness,
  TipDistributionError,
} from "../services/tipDistribution.service.js";

function getUserId(req: Request): string | null {
  return resolveRequestUserId(req);
}

export async function getMyTipDistributionSummary(req: Request, res: Response) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Authentication required" });
    const business = await businessService.getBusinessByUserId(userId);
    if (!business) return res.status(404).json({ message: "Business not found" });
    const summary = await loadTipDistributionSummaryForBusiness(business.id);
    return res.json(summary);
  } catch (err) {
    logServerError("tipDistribution.summary", err);
    return res.status(400).json({ message: clientSafeMessage(err, CLIENT_FALLBACK.generic) });
  }
}

export async function getMyTipDistributionEmployees(req: Request, res: Response) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Authentication required" });
    const business = await businessService.getBusinessByUserId(userId);
    if (!business) return res.status(404).json({ message: "Business not found" });
    const result = await listTipDistributionEmployeesForBusiness(business.id);
    return res.json(result);
  } catch (err) {
    logServerError("tipDistribution.employees", err);
    return res.status(400).json({ message: clientSafeMessage(err, CLIENT_FALLBACK.generic) });
  }
}

export async function getMyTipDistributionHistory(req: Request, res: Response) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Authentication required" });
    const business = await businessService.getBusinessByUserId(userId);
    if (!business) return res.status(404).json({ message: "Business not found" });
    const skip = parseBoundedSkip(req.query.skip);
    const takeRaw = Number(req.query.take);
    const take = Number.isInteger(takeRaw) ? takeRaw : 20;
    const result = await listTipDistributionBatchesForBusiness(business.id, { skip, take });
    return res.json(result);
  } catch (err) {
    logServerError("tipDistribution.history", err);
    return res.status(400).json({ message: clientSafeMessage(err, CLIENT_FALLBACK.generic) });
  }
}

export async function getMyTipDistributionBatch(req: Request, res: Response) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Authentication required" });
    const business = await businessService.getBusinessByUserId(userId);
    if (!business) return res.status(404).json({ message: "Business not found" });
    const id = typeof req.params.id === "string" ? req.params.id.trim() : "";
    if (!id) return res.status(400).json({ message: "Invalid batch id" });
    const batch = await getTipDistributionBatchForBusiness(business.id, id);
    if (!batch) return res.status(404).json({ message: "Distribution batch not found" });
    return res.json(batch);
  } catch (err) {
    logServerError("tipDistribution.batchDetail", err);
    return res.status(400).json({ message: clientSafeMessage(err, CLIENT_FALLBACK.generic) });
  }
}

export async function postMyTipDistributionBatch(req: Request, res: Response) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Authentication required" });
    const business = await businessService.getBusinessByUserId(userId);
    if (!business) return res.status(404).json({ message: "Business not found" });

    const body = req.body as {
      idempotencyKey?: unknown;
      paymentReference?: unknown;
      notes?: unknown;
      items?: unknown;
    };
    const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey : "";
    const itemsRaw = Array.isArray(body.items) ? body.items : [];
    const items = itemsRaw
      .map((row) => {
        if (!row || typeof row !== "object") return null;
        const employeeId = typeof (row as { employeeId?: unknown }).employeeId === "string"
          ? (row as { employeeId: string }).employeeId
          : "";
        const amountCents = Number((row as { amountCents?: unknown }).amountCents);
        const paymentReference =
          typeof (row as { paymentReference?: unknown }).paymentReference === "string"
            ? (row as { paymentReference: string }).paymentReference
            : undefined;
        if (!employeeId || !Number.isInteger(amountCents)) return null;
        return { employeeId, amountCents, paymentReference };
      })
      .filter((row): row is NonNullable<typeof row> => row != null);

    const batch = await createTipDistributionBatch({
      businessId: business.id,
      actorUserId: userId,
      idempotencyKey,
      paymentReference: typeof body.paymentReference === "string" ? body.paymentReference : null,
      notes: typeof body.notes === "string" ? body.notes : null,
      items,
    });

    await writeAuditLog({
      userId,
      action: "business.tip_distribution.recorded",
      metadata: JSON.stringify({
        businessId: business.id,
        batchId: batch.id,
        totalAmountCents: batch.totalAmountCents,
        employeeCount: batch.employeeCount,
      }),
    });

    return res.status(201).json(batch);
  } catch (err) {
    if (err instanceof TipDistributionError) {
      return res.status(err.status).json({ message: err.message, code: err.code });
    }
    logServerError("tipDistribution.create", err);
    return res.status(400).json({ message: clientSafeMessage(err, CLIENT_FALLBACK.generic) });
  }
}
