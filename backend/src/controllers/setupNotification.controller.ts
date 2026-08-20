import type { Request, Response } from "express";
import { prisma } from "../prisma.js";
import {
  actionSetupPrompt,
  dismissSetupPrompt,
  evaluateSetupPrompts,
  isSetupPromptKind,
  type SetupPromptEvaluateItem,
  type SetupPromptKind,
} from "../services/notifications/notificationIntelligence.service.js";
import { clientSafeMessage, logServerError } from "../utils/httpErrors.js";

function userIdFromReq(req: Request): string | null {
  return req.user?.userId ?? req.user?.id ?? null;
}

async function businessIdForUser(userId: string): Promise<string | null> {
  const business = await prisma.business.findUnique({
    where: { userId },
    select: { id: true },
  });
  return business?.id ?? null;
}

function parseItems(raw: unknown): SetupPromptEvaluateItem[] | null {
  if (!Array.isArray(raw)) return null;
  const items: SetupPromptEvaluateItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") return null;
    const kind = (entry as { kind?: unknown }).kind;
    const conditionActive = (entry as { conditionActive?: unknown }).conditionActive;
    const conditionVersion = (entry as { conditionVersion?: unknown }).conditionVersion;
    if (typeof kind !== "string" || !isSetupPromptKind(kind)) return null;
    if (typeof conditionActive !== "boolean") return null;
    if (typeof conditionVersion !== "string") return null;
    items.push({
      kind,
      conditionActive,
      conditionVersion,
    });
  }
  return items;
}

/**
 * POST /api/me/notifications/setup/evaluate
 * Body: { items: [{ kind, conditionActive, conditionVersion }] }
 */
export async function evaluateSetup(req: Request, res: Response) {
  try {
    const userId = userIdFromReq(req);
    if (!userId) return res.status(401).json({ message: "Authentication required" });

    const items = parseItems(req.body?.items);
    if (!items || items.length === 0) {
      return res.status(400).json({ message: "items array is required" });
    }
    if (items.length > 16) {
      return res.status(400).json({ message: "Too many items" });
    }

    const businessId = await businessIdForUser(userId);
    const results = await evaluateSetupPrompts(userId, businessId, items);
    return res.json({ results });
  } catch (err) {
    logServerError("notifications.evaluateSetup", err);
    return res.status(500).json({
      message: clientSafeMessage(err, "We couldn't evaluate setup prompts."),
    });
  }
}

/**
 * POST /api/me/notifications/setup/dismiss
 * Body: { kind, conditionVersion }
 */
export async function dismissSetup(req: Request, res: Response) {
  try {
    const userId = userIdFromReq(req);
    if (!userId) return res.status(401).json({ message: "Authentication required" });

    const kindRaw = req.body?.kind;
    const conditionVersion = req.body?.conditionVersion;
    if (typeof kindRaw !== "string" || !isSetupPromptKind(kindRaw)) {
      return res.status(400).json({ message: "Invalid setup prompt kind" });
    }
    if (typeof conditionVersion !== "string") {
      return res.status(400).json({ message: "conditionVersion is required" });
    }

    const kind = kindRaw as SetupPromptKind;
    const businessId = await businessIdForUser(userId);
    if (
      (kind === "stripe_connect" ||
        kind === "missing_employee_qr" ||
        kind === "onboarding_verification") &&
      !businessId
    ) {
      return res.status(403).json({ message: "Business context required" });
    }

    const result = await dismissSetupPrompt(userId, businessId, kind, conditionVersion);
    return res.json({ result });
  } catch (err) {
    logServerError("notifications.dismissSetup", err);
    return res.status(500).json({
      message: clientSafeMessage(err, "We couldn't dismiss that prompt."),
    });
  }
}

/**
 * POST /api/me/notifications/setup/actioned
 * Body: { kind, conditionVersion }
 */
export async function actionSetup(req: Request, res: Response) {
  try {
    const userId = userIdFromReq(req);
    if (!userId) return res.status(401).json({ message: "Authentication required" });

    const kindRaw = req.body?.kind;
    const conditionVersion = req.body?.conditionVersion;
    if (typeof kindRaw !== "string" || !isSetupPromptKind(kindRaw)) {
      return res.status(400).json({ message: "Invalid setup prompt kind" });
    }
    if (typeof conditionVersion !== "string") {
      return res.status(400).json({ message: "conditionVersion is required" });
    }

    const kind = kindRaw as SetupPromptKind;
    const businessId = await businessIdForUser(userId);
    if (
      (kind === "stripe_connect" ||
        kind === "missing_employee_qr" ||
        kind === "onboarding_verification") &&
      !businessId
    ) {
      return res.status(403).json({ message: "Business context required" });
    }

    const result = await actionSetupPrompt(userId, businessId, kind, conditionVersion);
    return res.json({ result });
  } catch (err) {
    logServerError("notifications.actionSetup", err);
    return res.status(500).json({
      message: clientSafeMessage(err, "We couldn't update that prompt."),
    });
  }
}
