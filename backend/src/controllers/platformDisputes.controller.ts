/**
 * Platform admin dispute management. Mounted behind requirePlatformAdmin (DB-verified SUPER_ADMIN) and
 * the platform audit middleware. Every Stripe-facing action re-reads Stripe; the ids used are the
 * stored ones, never ids from the request body.
 */
import type { Request, Response } from "express";
import { resolveRequestUserId } from "../middleware/auth.middleware.js";
import { prisma } from "../prisma.js";
import { logServerError } from "../utils/httpErrors.js";
import {
  disputeSummaryForAdmin,
  getDisputeDetailForAdmin,
  listDisputesForAdmin,
  updateDisputeInternalFields,
} from "../services/disputes/stripeDisputeAdmin.service.js";
import { syncStripeDisputeFromStripe } from "../services/disputes/stripeDisputeProjection.service.js";
import {
  buildEvidenceSuggestion,
  DisputeEvidenceError,
  saveEvidenceDraft,
  submitEvidence,
} from "../services/disputes/stripeDisputeEvidence.service.js";
import {
  approveAndRecover,
  cancelApprovedRecovery,
  DisputeRecoveryError,
  getRecoveryContext,
  retryApprovedRecovery,
} from "../services/disputes/stripeDisputeRecovery.service.js";

function disputeIdParam(req: Request): string | null {
  const id = String(req.params.id ?? "").trim();
  return /^[a-z0-9]{10,40}$/i.test(id) ? id : null;
}

function fail(res: Response, err: unknown, context: string) {
  if (err instanceof DisputeEvidenceError || err instanceof DisputeRecoveryError) {
    return res.status(err.httpStatus).json({ message: err.message, code: err.code });
  }
  const status = (err as { httpStatus?: unknown })?.httpStatus;
  if (typeof status === "number" && status >= 400 && status < 500) {
    return res.status(status).json({ message: (err as Error).message });
  }
  logServerError(context, err);
  return res.status(502).json({ message: "Stripe could not be reached. Please try again.", code: "STRIPE_UNAVAILABLE" });
}

async function existing(req: Request, res: Response): Promise<{ id: string; stripeDisputeId: string; stripeEventAccountId: string | null } | null> {
  const id = disputeIdParam(req);
  const row = id
    ? await prisma.stripeDispute.findUnique({ where: { id }, select: { id: true, stripeDisputeId: true, stripeEventAccountId: true } })
    : null;
  if (!row) {
    res.status(404).json({ message: "Dispute not found." });
    return null;
  }
  return row;
}

export async function listDisputes(req: Request, res: Response) {
  try {
    return res.json(await listDisputesForAdmin({ view: req.query.view, q: req.query.q, take: req.query.take, skip: req.query.skip }));
  } catch (err) {
    logServerError("platformDisputes.list", err);
    return res.status(500).json({ message: "Disputes could not be loaded." });
  }
}

export async function getDisputeSummary(_req: Request, res: Response) {
  try {
    return res.json(await disputeSummaryForAdmin());
  } catch (err) {
    logServerError("platformDisputes.summary", err);
    return res.status(500).json({ message: "Disputes could not be loaded." });
  }
}

export async function getDispute(req: Request, res: Response) {
  const id = disputeIdParam(req);
  if (!id) return res.status(404).json({ message: "Dispute not found." });
  try {
    const row = await getDisputeDetailForAdmin(id);
    if (!row) return res.status(404).json({ message: "Dispute not found." });
    return res.json(row);
  } catch (err) {
    logServerError("platformDisputes.get", err);
    return res.status(500).json({ message: "The dispute could not be loaded." });
  }
}

export async function postDisputeSync(req: Request, res: Response) {
  const row = await existing(req, res);
  if (!row) return;
  try {
    const result = await syncStripeDisputeFromStripe(row.stripeDisputeId, { source: "admin", stripeEventAccount: row.stripeEventAccountId });
    return res.json(result);
  } catch (err) {
    return fail(res, err, "platformDisputes.sync");
  }
}

export async function patchDisputeInternal(req: Request, res: Response) {
  const row = await existing(req, res);
  if (!row) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  // Stripe-owned fields are not accepted here at all.
  const forbidden = Object.keys(body).filter((k) => !["investigationStatus", "internalNotes"].includes(k));
  if (forbidden.length) {
    return res.status(400).json({ message: "Only the investigation status and internal notes can be changed here.", code: "STRIPE_OWNED_FIELD" });
  }
  try {
    await updateDisputeInternalFields({
      id: row.id,
      adminUserId: resolveRequestUserId(req)!,
      investigationStatus: body.investigationStatus,
      internalNotes: body.internalNotes,
    });
    return res.json({ ok: true });
  } catch (err) {
    return fail(res, err, "platformDisputes.internal");
  }
}

export async function getEvidenceSuggestion(req: Request, res: Response) {
  const row = await existing(req, res);
  if (!row) return;
  try {
    return res.json(await buildEvidenceSuggestion(row.id));
  } catch (err) {
    return fail(res, err, "platformDisputes.evidenceSuggestion");
  }
}

export async function putEvidenceDraft(req: Request, res: Response) {
  const row = await existing(req, res);
  if (!row) return;
  try {
    return res.json(await saveEvidenceDraft({ disputeRowId: row.id, adminUserId: resolveRequestUserId(req)!, draft: (req.body ?? {}).evidence }));
  } catch (err) {
    return fail(res, err, "platformDisputes.evidenceDraft");
  }
}

export async function postEvidenceSubmit(req: Request, res: Response) {
  const row = await existing(req, res);
  if (!row) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (body.confirm !== true) {
    return res.status(400).json({ message: "Confirm that you reviewed the evidence.", code: "CONFIRMATION_REQUIRED" });
  }
  try {
    return res.json(await submitEvidence({ disputeRowId: row.id, adminUserId: resolveRequestUserId(req)!, reviewedHash: body.reviewedHash }));
  } catch (err) {
    return fail(res, err, "platformDisputes.evidenceSubmit");
  }
}

export async function postDisputeRecovery(req: Request, res: Response) {
  const row = await existing(req, res);
  if (!row) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (body.confirm !== true) {
    return res.status(400).json({ message: "Confirm the recovery.", code: "CONFIRMATION_REQUIRED" });
  }
  if (body.transferId !== undefined || body.accountId !== undefined || body.stripeAccountId !== undefined) {
    return res.status(400).json({ message: "Transfer and account come from Stripe, not from the request.", code: "CLIENT_STRIPE_ID_REJECTED" });
  }
  try {
    const result = await approveAndRecover({
      disputeRowId: row.id,
      adminUserId: resolveRequestUserId(req)!,
      ...(body.amountCents !== undefined ? { amountCents: Number(body.amountCents) } : {}),
    });
    return res.json(result);
  } catch (err) {
    return fail(res, err, "platformDisputes.recovery");
  }
}

/** POST /disputes/:id/recovery/retry — "retry now" within the existing approval (confirmation required). */
export async function postDisputeRecoveryRetry(req: Request, res: Response) {
  const row = await existing(req, res);
  if (!row) return;
  if ((req.body ?? {}).confirm !== true) {
    return res.status(400).json({ message: "Confirm the retry.", code: "CONFIRMATION_REQUIRED" });
  }
  try {
    return res.json(await retryApprovedRecovery({ disputeRowId: row.id, adminUserId: resolveRequestUserId(req)! }));
  } catch (err) {
    return fail(res, err, "platformDisputes.recoveryRetry");
  }
}

/** POST /disputes/:id/recovery/cancel — stops an approval and its retries; moves no money. */
export async function postDisputeRecoveryCancel(req: Request, res: Response) {
  const row = await existing(req, res);
  if (!row) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (body.confirm !== true) {
    return res.status(400).json({ message: "Confirm the cancellation.", code: "CONFIRMATION_REQUIRED" });
  }
  try {
    const cancelled = await cancelApprovedRecovery({
      disputeRowId: row.id,
      adminUserId: resolveRequestUserId(req)!,
      reason: typeof body.reason === "string" ? body.reason.slice(0, 160) : "",
    });
    return res.json({ cancelled });
  } catch (err) {
    return fail(res, err, "platformDisputes.recoveryCancel");
  }
}

/** GET /disputes/:id/recovery/context — transfer, reversals and account balance read from Stripe. */
export async function getDisputeRecoveryContext(req: Request, res: Response) {
  const row = await existing(req, res);
  if (!row) return;
  try {
    return res.json(await getRecoveryContext(row.id));
  } catch (err) {
    return fail(res, err, "platformDisputes.recoveryContext");
  }
}
