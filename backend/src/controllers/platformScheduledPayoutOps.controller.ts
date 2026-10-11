import type { Request, Response } from "express";
import {
  ScheduledPayoutFailureClassification,
  ScheduledPayoutReconciliationStatus,
  StripeConnectScheduledPayoutRequestStatus,
} from "@prisma/client";
import { parseBoundedSkip } from "../utils/paginationLimits.js";
import { clientSafeMessage, logServerError } from "../utils/httpErrors.js";
import { normalizeConnectPayoutMethod } from "../lib/connectPayoutMethod.util.js";
import {
  getScheduledPayoutOpsDetail,
  getScheduledPayoutOpsSummary,
  listScheduledPayoutOps,
  manualAttachScheduledPayoutOpsLedger,
  reconcileScheduledPayoutOpsLedger,
  runScheduledPayoutOpsRecovery,
  type ScheduledPayoutOpsType,
} from "../services/platformScheduledPayoutOperations.service.js";

function parsePayoutType(raw: string | undefined): ScheduledPayoutOpsType | null {
  if (raw === "employee" || raw === "business") return raw;
  return null;
}

function parseIsoDate(raw: string | undefined): Date | undefined {
  if (!raw?.trim()) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function parseStatus(raw: string | undefined): StripeConnectScheduledPayoutRequestStatus | undefined {
  if (!raw?.trim()) return undefined;
  const values = Object.values(StripeConnectScheduledPayoutRequestStatus);
  return values.includes(raw as StripeConnectScheduledPayoutRequestStatus)
    ? (raw as StripeConnectScheduledPayoutRequestStatus)
    : undefined;
}

function parseReconciliationStatus(
  raw: string | undefined,
): ScheduledPayoutReconciliationStatus | undefined {
  if (!raw?.trim()) return undefined;
  const values = Object.values(ScheduledPayoutReconciliationStatus);
  return values.includes(raw as ScheduledPayoutReconciliationStatus)
    ? (raw as ScheduledPayoutReconciliationStatus)
    : undefined;
}

function parseFailureClassification(
  raw: string | undefined,
): ScheduledPayoutFailureClassification | undefined {
  if (!raw?.trim()) return undefined;
  const values = Object.values(ScheduledPayoutFailureClassification);
  return values.includes(raw as ScheduledPayoutFailureClassification)
    ? (raw as ScheduledPayoutFailureClassification)
    : undefined;
}

export async function getScheduledPayoutOperationsSummary(_req: Request, res: Response) {
  try {
    const summary = await getScheduledPayoutOpsSummary();
    return res.json(summary);
  } catch (err) {
    logServerError("platform.scheduledPayoutOps.summary", err);
    return res.status(500).json({
      message: clientSafeMessage(err, "We couldn't load scheduled payout summary. Try again."),
    });
  }
}

export async function listScheduledPayoutOperations(req: Request, res: Response) {
  try {
    const take = Math.min(Math.max(Number(req.query.take) || 50, 1), 100);
    const skip = parseBoundedSkip(req.query.skip);
    const q = typeof req.query.q === "string" ? req.query.q.slice(0, 120) : undefined;
    const payoutType = parsePayoutType(
      typeof req.query.payoutType === "string" ? req.query.payoutType : undefined,
    );
    const businessId =
      typeof req.query.businessId === "string" ? req.query.businessId.trim().slice(0, 64) : undefined;
    const status = parseStatus(typeof req.query.status === "string" ? req.query.status : undefined);
    const reconciliationStatus = parseReconciliationStatus(
      typeof req.query.reconciliationStatus === "string" ? req.query.reconciliationStatus : undefined,
    );
    const failureClassification = parseFailureClassification(
      typeof req.query.failureClassification === "string" ? req.query.failureClassification : undefined,
    );
    const blockedReason =
      typeof req.query.blockedReason === "string"
        ? req.query.blockedReason.trim().slice(0, 64)
        : undefined;
    const manualOnly = req.query.manualOnly === "true" || req.query.manualOnly === "1";
    const updatedFrom = parseIsoDate(
      typeof req.query.updatedFrom === "string" ? req.query.updatedFrom : undefined,
    );
    const updatedTo = parseIsoDate(
      typeof req.query.updatedTo === "string" ? req.query.updatedTo : undefined,
    );
    const methodRaw =
      typeof req.query.method === "string" ? req.query.method.trim().toLowerCase() : undefined;
    const method =
      methodRaw === "instant" || methodRaw === "standard" || methodRaw === "unknown"
        ? normalizeConnectPayoutMethod(methodRaw)
        : undefined;
    if (
      typeof req.query.method === "string" &&
      methodRaw &&
      methodRaw !== "instant" &&
      methodRaw !== "standard" &&
      methodRaw !== "unknown"
    ) {
      return res.status(400).json({ message: "Invalid method." });
    }

    if (typeof req.query.payoutType === "string" && !payoutType) {
      return res.status(400).json({ message: "Invalid payoutType." });
    }
    if (typeof req.query.status === "string" && req.query.status && !status) {
      return res.status(400).json({ message: "Invalid status." });
    }

    const result = await listScheduledPayoutOps({
      take,
      skip,
      q,
      payoutType: payoutType ?? undefined,
      businessId,
      status,
      reconciliationStatus,
      failureClassification,
      blockedReason,
      manualOnly,
      updatedFrom,
      updatedTo,
      method,
    });
    return res.json(result);
  } catch (err) {
    logServerError("platform.scheduledPayoutOps.list", err);
    return res.status(500).json({
      total: 0,
      items: [],
      message: clientSafeMessage(err, "We couldn't load scheduled payout operations. Try again."),
    });
  }
}

export async function getScheduledPayoutOperationDetail(req: Request, res: Response) {
  try {
    const payoutType = parsePayoutType(req.params.payoutType);
    const ledgerId = typeof req.params.ledgerId === "string" ? req.params.ledgerId.trim() : "";
    if (!payoutType || !ledgerId) {
      return res.status(400).json({ message: "Invalid payout type or ledger id." });
    }
    const detail = await getScheduledPayoutOpsDetail(payoutType, ledgerId);
    if (!detail) return res.status(404).json({ message: "Ledger not found." });
    return res.json(detail);
  } catch (err) {
    logServerError("platform.scheduledPayoutOps.detail", err);
    return res.status(500).json({
      message: clientSafeMessage(err, "We couldn't load that ledger. Try again."),
    });
  }
}

function actorId(req: Request): string | null {
  return req.user?.sub ?? req.user?.userId ?? req.user?.id ?? null;
}

export async function postScheduledPayoutReconcile(req: Request, res: Response) {
  try {
    const payoutType = parsePayoutType(req.params.payoutType);
    const ledgerId = typeof req.params.ledgerId === "string" ? req.params.ledgerId.trim() : "";
    if (!payoutType || !ledgerId) {
      return res.status(400).json({ message: "Invalid payout type or ledger id." });
    }
    const result = await reconcileScheduledPayoutOpsLedger(payoutType, ledgerId, actorId(req));
    return res.json(result);
  } catch (err) {
    logServerError("platform.scheduledPayoutOps.reconcile", err);
    return res.status(500).json({
      message: clientSafeMessage(err, "Reconciliation could not be completed. Try again."),
    });
  }
}

export async function postScheduledPayoutRunRecovery(req: Request, res: Response) {
  try {
    const payoutType = parsePayoutType(req.params.payoutType);
    const ledgerId = typeof req.params.ledgerId === "string" ? req.params.ledgerId.trim() : "";
    if (!payoutType || !ledgerId) {
      return res.status(400).json({ message: "Invalid payout type or ledger id." });
    }
    const result = await runScheduledPayoutOpsRecovery(payoutType, ledgerId, actorId(req));
    return res.json(result);
  } catch (err) {
    logServerError("platform.scheduledPayoutOps.runRecovery", err);
    return res.status(500).json({
      message: clientSafeMessage(err, "Recovery could not be run. Try again."),
    });
  }
}

export async function postScheduledPayoutManualAttachment(req: Request, res: Response) {
  try {
    const payoutType = parsePayoutType(req.params.payoutType);
    const ledgerId = typeof req.params.ledgerId === "string" ? req.params.ledgerId.trim() : "";
    if (!payoutType || !ledgerId) {
      return res.status(400).json({ message: "Invalid payout type or ledger id." });
    }
    const body = req.body as {
      stripePayoutId?: string;
      evidenceSummary?: string;
      confirmNoDuplicate?: boolean;
    };
    const result = await manualAttachScheduledPayoutOpsLedger({
      payoutType,
      ledgerId,
      stripePayoutId: String(body.stripePayoutId ?? ""),
      evidenceSummary: String(body.evidenceSummary ?? ""),
      confirmNoDuplicate: body.confirmNoDuplicate === true,
      actorUserId: actorId(req),
    });
    if (result.status === "failed" && result.message === "manual_attachment_disabled") {
      return res.status(403).json(result);
    }
    return res.json(result);
  } catch (err) {
    logServerError("platform.scheduledPayoutOps.manualAttachment", err);
    return res.status(500).json({
      message: clientSafeMessage(err, "Manual attachment could not be completed. Try again."),
    });
  }
}
