import type { Request, Response } from "express";
import { Role } from "@prisma/client";
import {
  createMyPlatformProductFeedback,
  getMyPlatformProductFeedbackOverview,
  getPlatformProductFeedbackAdminById,
  getPlatformProductFeedbackSummary,
  listPlatformProductFeedbackAdmin,
  PlatformProductFeedbackError,
  updatePlatformProductFeedbackAdminStatus,
} from "../services/platformProductFeedback.service.js";
import {
  parsePlatformProductFeedbackAdminStatus,
  parsePlatformProductFeedbackPayload,
} from "../lib/platformProductFeedbackValidation.js";
import { resolveRequestUserId } from "../middleware/auth.middleware.js";
import { parseBoundedSkip } from "../utils/paginationLimits.js";
import { clientSafeMessage, CLIENT_FALLBACK, logServerError } from "../utils/httpErrors.js";

const MAX_LIST_TAKE = 100;

function parseListTake(raw: unknown): number {
  return Math.max(1, Math.min(MAX_LIST_TAKE, Number(raw ?? 20) || 20));
}

function mapServiceError(err: unknown, fallback: string): { status: number; message: string } {
  if (err instanceof PlatformProductFeedbackError) {
    if (err.code === "NOT_FOUND") return { status: 404, message: err.message };
    if (err.code === "FORBIDDEN") return { status: 403, message: err.message };
    return { status: 400, message: err.message };
  }
  return { status: 500, message: fallback };
}

function userIdFromReq(req: Request): string | null {
  return resolveRequestUserId(req);
}

function roleFromReq(req: Request): Role | null {
  const role = req.authUser?.role ?? req.user?.role;
  return role ?? null;
}

export async function getMyProductReview(req: Request, res: Response) {
  try {
    const userId = userIdFromReq(req);
    if (!userId) return res.status(401).json({ message: "Authentication required" });

    const overview = await getMyPlatformProductFeedbackOverview(userId);
    return res.json(overview);
  } catch (err) {
    logServerError("platformProductFeedback.getMy", err);
    return res.status(500).json({
      message: clientSafeMessage(err, CLIENT_FALLBACK.employee),
    });
  }
}

export async function createMyProductReview(req: Request, res: Response) {
  try {
    const userId = userIdFromReq(req);
    if (!userId) return res.status(401).json({ message: "Authentication required" });

    const role = roleFromReq(req);
    if (role !== Role.MANAGER && role !== Role.EMPLOYEE) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }

    const parsed = parsePlatformProductFeedbackPayload(req.body);
    if (!parsed.ok) return res.status(400).json({ message: parsed.message });

    const result = await createMyPlatformProductFeedback({
      userId,
      role,
      payload: parsed.value,
    });

    return res.json({ feedback: result.feedback });
  } catch (err) {
    const mapped = mapServiceError(err, "We couldn't save your feedback.");
    if (mapped.status >= 500) logServerError("platformProductFeedback.createMy", err);
    return res.status(mapped.status).json({ message: mapped.message });
  }
}

export async function listPlatformProductReviews(req: Request, res: Response) {
  try {
    const take = parseListTake(req.query.take);
    const skip = parseBoundedSkip(req.query.skip);

    const ratingRaw = req.query.rating;
    const rating =
      typeof ratingRaw === "string" && ratingRaw.trim()
        ? Number(ratingRaw)
        : undefined;
    const ratingFilter =
      rating != null && Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : undefined;

    const submitterRoleRaw =
      typeof req.query.submitterRole === "string" ? req.query.submitterRole.trim() : "";
    const submitterRole =
      submitterRoleRaw === Role.MANAGER || submitterRoleRaw === Role.EMPLOYEE
        ? submitterRoleRaw
        : undefined;

    const adminStatusRaw =
      typeof req.query.adminStatus === "string" ? req.query.adminStatus : undefined;
    const adminStatus = adminStatusRaw ? parsePlatformProductFeedbackAdminStatus(adminStatusRaw) : undefined;
    if (adminStatusRaw && !adminStatus) {
      return res.status(400).json({ message: "Invalid adminStatus filter." });
    }

    const createdFrom =
      typeof req.query.createdFrom === "string" && req.query.createdFrom.trim()
        ? new Date(req.query.createdFrom)
        : undefined;
    const createdTo =
      typeof req.query.createdTo === "string" && req.query.createdTo.trim()
        ? new Date(req.query.createdTo)
        : undefined;
    if (createdFrom && Number.isNaN(createdFrom.getTime())) {
      return res.status(400).json({ message: "Invalid createdFrom date." });
    }
    if (createdTo && Number.isNaN(createdTo.getTime())) {
      return res.status(400).json({ message: "Invalid createdTo date." });
    }

    const result = await listPlatformProductFeedbackAdmin({
      take,
      skip,
      rating: ratingFilter,
      submitterRole,
      adminStatus: adminStatus ?? undefined,
      createdFrom,
      createdTo,
    });

    return res.json(result);
  } catch (err) {
    logServerError("platformProductFeedback.listPlatform", err);
    return res.status(500).json({
      message: clientSafeMessage(err, CLIENT_FALLBACK.employee),
    });
  }
}

export async function getPlatformProductReviewSummary(_req: Request, res: Response) {
  try {
    const summary = await getPlatformProductFeedbackSummary();
    return res.json({ summary });
  } catch (err) {
    logServerError("platformProductFeedback.summary", err);
    return res.status(500).json({
      message: clientSafeMessage(err, CLIENT_FALLBACK.employee),
    });
  }
}

export async function getPlatformProductReviewById(req: Request, res: Response) {
  try {
    const feedback = await getPlatformProductFeedbackAdminById(req.params.id);
    if (!feedback) return res.status(404).json({ message: "Product feedback not found" });
    return res.json({ feedback });
  } catch (err) {
    logServerError("platformProductFeedback.getPlatformById", err);
    return res.status(500).json({
      message: clientSafeMessage(err, CLIENT_FALLBACK.employee),
    });
  }
}

export async function patchPlatformProductReviewStatus(req: Request, res: Response) {
  try {
    const adminUserId = userIdFromReq(req);
    if (!adminUserId) return res.status(401).json({ message: "Authentication required" });

    const adminStatus = parsePlatformProductFeedbackAdminStatus(req.body?.adminStatus);
    if (!adminStatus) return res.status(400).json({ message: "Invalid adminStatus" });

    const forbiddenKeys = ["userId", "businessId", "employeeId", "rating", "comment", "submitterRole"];
    for (const key of forbiddenKeys) {
      if (key in (req.body as object)) {
        return res.status(400).json({ message: `Field ${key} cannot be updated.` });
      }
    }

    const feedback = await updatePlatformProductFeedbackAdminStatus({
      adminUserId,
      feedbackId: req.params.id,
      adminStatus,
    });
    return res.json({ feedback });
  } catch (err) {
    const mapped = mapServiceError(err, "We couldn't update product feedback status.");
    if (mapped.status >= 500) logServerError("platformProductFeedback.patchStatus", err);
    return res.status(mapped.status).json({ message: mapped.message });
  }
}
