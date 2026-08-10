import type { Request, Response } from "express";
import { Role } from "@prisma/client";
import { CLIENT_FALLBACK, clientSafeMessage, logServerError } from "../utils/httpErrors.js";
import {
  OwnershipTransferError,
  transferBusinessOwnership,
  transferOwnershipAsOwner,
} from "../services/businessOwnership.service.js";
import {
  DsarExportError,
  createDsarExportJob,
  downloadDsarExportForUser,
  getDsarExportJobForUser,
  processDsarExportJob,
} from "../services/dsarExport.service.js";

function getUserId(req: Request): string | null {
  const uid = req.user?.userId ?? req.user?.id ?? req.user?.sub;
  return typeof uid === "string" && uid.trim() ? uid.trim() : null;
}

function mapOwnershipError(err: unknown, res: Response) {
  if (err instanceof OwnershipTransferError) {
    const status =
      err.code === "NOT_FOUND"
        ? 404
        : err.code === "FORBIDDEN" || err.code === "INVALID_SUCCESSOR"
          ? 403
          : err.code === "TOMBSTONED" || err.code === "LEGAL_HOLD" || err.code === "CONFLICT"
            ? 409
            : err.code === "AUDIT_FAILED"
              ? 503
            : 400;
    return res.status(status).json({ message: err.message, code: err.code });
  }
  return null;
}

function mapDsarError(err: unknown, res: Response) {
  if (err instanceof DsarExportError) {
    const status =
      err.code === "NOT_FOUND"
        ? 404
        : err.code === "FORBIDDEN" || err.code === "DENIED_STATUS"
          ? 403
          : err.code === "EXPIRED"
            ? 410
            : err.code === "NOT_READY" || err.code === "ARTIFACT_MISSING"
              ? 202
              : 400;
    return res.status(status).json({ message: err.message, code: err.code });
  }
  return null;
}

/** POST /api/business/ownership/transfer — current owner only; ignores forged businessId. */
export async function transferOwnershipAsManager(req: Request, res: Response) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Authentication required" });
    if (req.user?.role !== Role.MANAGER) {
      return res.status(403).json({ message: "Manager role required" });
    }
    const body = req.body as {
      successorUserId?: unknown;
      successorEmail?: unknown;
      businessId?: unknown;
    };
    let successorUserId =
      typeof body.successorUserId === "string" ? body.successorUserId.trim() : "";
    if (!successorUserId && typeof body.successorEmail === "string") {
      const { prisma } = await import("../prisma.js");
      const email = body.successorEmail.trim().toLowerCase();
      const row = await prisma.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (!row) {
        return res.status(404).json({ message: "Successor user not found", code: "INVALID_SUCCESSOR" });
      }
      successorUserId = row.id;
    }
    if (!successorUserId) {
      return res.status(400).json({ message: "successorUserId or successorEmail is required" });
    }
    const clientBusinessId =
      typeof body.businessId === "string" ? body.businessId : undefined;
    const result = await transferOwnershipAsOwner(userId, successorUserId, clientBusinessId);
    return res.json({ ok: true, ...result });
  } catch (err) {
    if (mapOwnershipError(err, res)) return;
    logServerError("business.transferOwnership", err);
    return res.status(400).json({ message: clientSafeMessage(err, CLIENT_FALLBACK.generic) });
  }
}

/** POST /api/platform/businesses/:id/ownership/transfer */
export async function transferOwnershipAsPlatform(req: Request, res: Response) {
  try {
    const actorId = getUserId(req);
    if (!actorId) return res.status(401).json({ message: "Authentication required" });
    const businessId = typeof req.params.id === "string" ? req.params.id.trim() : "";
    if (!businessId) return res.status(400).json({ message: "id is required" });
    const body = req.body as { successorUserId?: unknown };
    const successorUserId =
      typeof body.successorUserId === "string" ? body.successorUserId.trim() : "";
    if (!successorUserId) {
      return res.status(400).json({ message: "successorUserId is required" });
    }
    const result = await transferBusinessOwnership({
      businessId,
      successorUserId,
      actorUserId: actorId,
      source: "platform",
    });
    return res.json({ ok: true, ...result });
  } catch (err) {
    if (mapOwnershipError(err, res)) return;
    logServerError("platform.transferOwnership", err);
    return res.status(400).json({ message: clientSafeMessage(err, CLIENT_FALLBACK.generic) });
  }
}

/** POST /api/me/export — async-first DSAR (HTTP 202). */
export async function postMyExport(req: Request, res: Response) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Authentication required" });
    // Reject attempts to target another user via body.
    const body = req.body as { userId?: unknown; businessId?: unknown } | undefined;
    if (body?.userId && String(body.userId) !== userId) {
      return res.status(403).json({ message: "Cannot export another user's data", code: "FORBIDDEN" });
    }
    if (body?.businessId) {
      // Managers export their owned business only via subject resolution — never by client businessId.
      const { prisma } = await import("../prisma.js");
      const owned = await prisma.business.findUnique({
        where: { userId },
        select: { id: true },
      });
      if (!owned || owned.id !== String(body.businessId)) {
        return res.status(403).json({
          message: "Cannot export another Business's data",
          code: "FORBIDDEN",
        });
      }
    }

    const created = await createDsarExportJob(userId);
    // Best-effort: wait briefly for small inline packages so polls often see succeeded.
    await Promise.race([
      processDsarExportJob(created.jobId),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
    const status = await getDsarExportJobForUser(userId, created.jobId);
    return res.status(202).json({
      jobId: created.jobId,
      status: status.status,
      expiresAt: created.expiresAt,
      downloadToken: created.downloadToken,
      poll: `/api/me/export/${created.jobId}`,
      download: `/api/me/export/${created.jobId}/download`,
      /**
       * MVP: complete this download before confirming account deletion.
       * After deletion confirmation, sessions end and /api/me/export is unavailable.
       */
      exportBeforeDeletionRequired: true,
    });
  } catch (err) {
    if (mapDsarError(err, res)) return;
    logServerError("me.postMyExport", err);
    return res.status(400).json({ message: clientSafeMessage(err, CLIENT_FALLBACK.generic) });
  }
}

/** GET /api/me/export/:jobId */
export async function getMyExportJob(req: Request, res: Response) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Authentication required" });
    const jobId = typeof req.params.jobId === "string" ? req.params.jobId.trim() : "";
    if (!jobId) return res.status(400).json({ message: "jobId is required" });
    const status = await getDsarExportJobForUser(userId, jobId);
    if (status.status === "pending" || status.status === "running") {
      await processDsarExportJob(jobId).catch(() => undefined);
      const again = await getDsarExportJobForUser(userId, jobId);
      return res.status(again.status === "succeeded" ? 200 : 202).json(again);
    }
    return res.json(status);
  } catch (err) {
    if (mapDsarError(err, res)) return;
    logServerError("me.getMyExportJob", err);
    return res.status(400).json({ message: clientSafeMessage(err, CLIENT_FALLBACK.generic) });
  }
}

/** GET /api/me/export/:jobId/download */
export async function downloadMyExport(req: Request, res: Response) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Authentication required" });
    const jobId = typeof req.params.jobId === "string" ? req.params.jobId.trim() : "";
    if (!jobId) return res.status(400).json({ message: "jobId is required" });
    const tokenRaw = req.query.token;
    const downloadToken = typeof tokenRaw === "string" ? tokenRaw : null;
    const result = await downloadDsarExportForUser({ userId, jobId, downloadToken });
    if (result.mode === "redirect") {
      return res.json({
        downloadUrl: result.url,
        expiresAt: result.expiresAt,
        note: "Short-lived signed URL; do not share.",
      });
    }
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="caretip-dsar-${jobId}.json"`);
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).json(result.body);
  } catch (err) {
    if (mapDsarError(err, res)) return;
    logServerError("me.downloadMyExport", err);
    return res.status(400).json({ message: clientSafeMessage(err, CLIENT_FALLBACK.generic) });
  }
}
