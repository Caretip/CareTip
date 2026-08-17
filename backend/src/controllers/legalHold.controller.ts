/**
 * Platform-admin legal hold APIs (GDPR Slice G).
 * Routes are mounted under /api/platform with requirePlatformAdmin.
 */

import type { Request, Response } from "express";
import { CLIENT_FALLBACK, clientSafeMessage, logServerError } from "../utils/httpErrors.js";
import {
  LegalHoldError,
  clearBusinessLegalHold,
  clearUserLegalHold,
  getBusinessLegalHold,
  getUserLegalHold,
  searchLegalHoldSubjects,
  setBusinessLegalHold,
  setUserLegalHold,
} from "../services/legalHold.service.js";

function getActorId(req: Request): string | null {
  const uid = req.user?.userId ?? req.user?.id ?? req.user?.sub;
  return typeof uid === "string" && uid.trim() ? uid.trim() : null;
}

function mapLegalHoldError(err: unknown, res: Response) {
  if (err instanceof LegalHoldError) {
    const status =
      err.code === "NOT_FOUND"
        ? 404
        : err.code === "FORBIDDEN"
          ? 403
          : err.code === "AUDIT_FAILED"
            ? 503
            : err.code === "CONFLICT"
              ? 409
              : 400;
    return res.status(status).json({ message: err.message, code: err.code });
  }
  return null;
}

/** GET /api/platform/users/:userId/legal-hold */
export async function getPlatformUserLegalHold(req: Request, res: Response) {
  try {
    const actorId = getActorId(req);
    if (!actorId) return res.status(401).json({ message: "Authentication required" });
    const userId = String(req.params.userId ?? "").trim();
    if (!userId) return res.status(400).json({ message: "userId is required", code: "VALIDATION" });
    const state = await getUserLegalHold(userId, actorId);
    return res.json(state);
  } catch (err) {
    if (mapLegalHoldError(err, res)) return;
    logServerError("legalHold.getUser", err);
    return res.status(500).json({ message: clientSafeMessage(err, CLIENT_FALLBACK.generic) });
  }
}

/** PUT /api/platform/users/:userId/legal-hold */
export async function putPlatformUserLegalHold(req: Request, res: Response) {
  try {
    const actorId = getActorId(req);
    if (!actorId) return res.status(401).json({ message: "Authentication required" });
    const userId = String(req.params.userId ?? "").trim();
    if (!userId) return res.status(400).json({ message: "userId is required", code: "VALIDATION" });
    const body = req.body as { reason?: unknown; categories?: unknown };
    const state = await setUserLegalHold({
      userId,
      actorUserId: actorId,
      reason: body.reason,
      categories: body.categories,
    });
    return res.json(state);
  } catch (err) {
    if (mapLegalHoldError(err, res)) return;
    logServerError("legalHold.setUser", err);
    return res.status(500).json({ message: clientSafeMessage(err, CLIENT_FALLBACK.generic) });
  }
}

/** DELETE /api/platform/users/:userId/legal-hold */
export async function deletePlatformUserLegalHold(req: Request, res: Response) {
  try {
    const actorId = getActorId(req);
    if (!actorId) return res.status(401).json({ message: "Authentication required" });
    const userId = String(req.params.userId ?? "").trim();
    if (!userId) return res.status(400).json({ message: "userId is required", code: "VALIDATION" });
    const state = await clearUserLegalHold({
      userId,
      actorUserId: actorId,
      releaseReason: (req.body as { reason?: unknown } | undefined)?.reason,
    });
    return res.json(state);
  } catch (err) {
    if (mapLegalHoldError(err, res)) return;
    logServerError("legalHold.clearUser", err);
    return res.status(500).json({ message: clientSafeMessage(err, CLIENT_FALLBACK.generic) });
  }
}

/** GET /api/platform/businesses/:id/legal-hold */
export async function getPlatformBusinessLegalHold(req: Request, res: Response) {
  try {
    const actorId = getActorId(req);
    if (!actorId) return res.status(401).json({ message: "Authentication required" });
    const businessId = String(req.params.id ?? "").trim();
    if (!businessId) {
      return res.status(400).json({ message: "business id is required", code: "VALIDATION" });
    }
    const state = await getBusinessLegalHold(businessId, actorId);
    return res.json(state);
  } catch (err) {
    if (mapLegalHoldError(err, res)) return;
    logServerError("legalHold.getBusiness", err);
    return res.status(500).json({ message: clientSafeMessage(err, CLIENT_FALLBACK.generic) });
  }
}

/** PUT /api/platform/businesses/:id/legal-hold */
export async function putPlatformBusinessLegalHold(req: Request, res: Response) {
  try {
    const actorId = getActorId(req);
    if (!actorId) return res.status(401).json({ message: "Authentication required" });
    const businessId = String(req.params.id ?? "").trim();
    if (!businessId) {
      return res.status(400).json({ message: "business id is required", code: "VALIDATION" });
    }
    const body = req.body as { reason?: unknown; categories?: unknown };
    const state = await setBusinessLegalHold({
      businessId,
      actorUserId: actorId,
      reason: body.reason,
      categories: body.categories,
    });
    return res.json(state);
  } catch (err) {
    if (mapLegalHoldError(err, res)) return;
    logServerError("legalHold.setBusiness", err);
    return res.status(500).json({ message: clientSafeMessage(err, CLIENT_FALLBACK.generic) });
  }
}

/** DELETE /api/platform/businesses/:id/legal-hold */
export async function deletePlatformBusinessLegalHold(req: Request, res: Response) {
  try {
    const actorId = getActorId(req);
    if (!actorId) return res.status(401).json({ message: "Authentication required" });
    const businessId = String(req.params.id ?? "").trim();
    if (!businessId) {
      return res.status(400).json({ message: "business id is required", code: "VALIDATION" });
    }
    const state = await clearBusinessLegalHold({
      businessId,
      actorUserId: actorId,
      releaseReason: (req.body as { reason?: unknown } | undefined)?.reason,
    });
    return res.json(state);
  } catch (err) {
    if (mapLegalHoldError(err, res)) return;
    logServerError("legalHold.clearBusiness", err);
    return res.status(500).json({ message: clientSafeMessage(err, CLIENT_FALLBACK.generic) });
  }
}

/**
 * GET /api/platform/legal-hold/subjects?type=user|business&q=
 * Tightly scoped Platform Admin lookup for Legal Hold UI (minimal fields).
 */
export async function searchPlatformLegalHoldSubjects(req: Request, res: Response) {
  try {
    const actorId = getActorId(req);
    if (!actorId) return res.status(401).json({ message: "Authentication required" });
    const typeRaw = String(req.query.type ?? "business").trim().toLowerCase();
    const subjectType = typeRaw === "user" ? "user" : "business";
    const q = String(req.query.q ?? "").trim();
    if (!q) return res.json({ items: [] });
    const items = await searchLegalHoldSubjects({
      actorUserId: actorId,
      subjectType,
      q,
    });
    return res.json({ items });
  } catch (err) {
    if (mapLegalHoldError(err, res)) return;
    logServerError("legalHold.searchSubjects", err);
    return res.status(500).json({ message: clientSafeMessage(err, CLIENT_FALLBACK.generic) });
  }
}
