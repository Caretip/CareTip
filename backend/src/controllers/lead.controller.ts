import type { Request, Response } from "express";
import { notifyLeadInbox, type CrmLeadPayload, type LeadType } from "../services/leadNotification.service.js";
import { logServerError, clientSafeMessage, CLIENT_FALLBACK } from "../utils/httpErrors.js";

const MAX_FIELD_LEN = 4000;
const MAX_NAME_LEN = 200;

function trimField(value: unknown, max = MAX_FIELD_LEN): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function buildPayload(
  req: Request,
  type: LeadType,
  fields: Record<string, string>,
): CrmLeadPayload {
  const locale = trimField(req.body?.locale, 12) ?? "en";
  return {
    source: "caretip_contact",
    type,
    submittedAt: new Date().toISOString(),
    locale,
    fields,
    metadata: {
      userAgent: typeof req.get("user-agent") === "string" ? req.get("user-agent")! : undefined,
      referer: typeof req.get("referer") === "string" ? req.get("referer")! : undefined,
      ip: req.ip,
    },
  };
}

export async function submitDemoLead(req: Request, res: Response) {
  try {
    const fullName = trimField(req.body?.fullName, MAX_NAME_LEN);
    const workEmail = trimField(req.body?.workEmail, 320);
    const businessName = trimField(req.body?.businessName, MAX_NAME_LEN);
    const businessType = trimField(req.body?.businessType, 80);
    const teamSize = trimField(req.body?.teamSize, 40);
    const message = trimField(req.body?.message);

    if (!fullName || !workEmail || !businessName || !businessType || !teamSize || !message) {
      return res.status(400).json({ message: "Please complete all required fields." });
    }
    if (!isValidEmail(workEmail)) {
      return res.status(400).json({ message: "Please enter a valid work email." });
    }

    const payload = buildPayload(req, "demo", {
      fullName,
      workEmail,
      businessName,
      businessType,
      teamSize,
      message,
    });

    const sent = await notifyLeadInbox(payload);
    if (!sent && process.env.NODE_ENV === "production") {
      return res.status(503).json({ message: "Unable to send your request right now. Please email info@caretip.de." });
    }

    return res.status(201).json({ ok: true, leadId: `demo_${Date.now()}` });
  } catch (err) {
    logServerError("lead.demo", err);
    return res.status(500).json({ message: clientSafeMessage(err, CLIENT_FALLBACK.generic) });
  }
}

export async function submitSupportLead(req: Request, res: Response) {
  try {
    const name = trimField(req.body?.name, MAX_NAME_LEN);
    const email = trimField(req.body?.email, 320);
    const category = trimField(req.body?.category, 80);
    const message = trimField(req.body?.message);

    if (!name || !email || !category || !message) {
      return res.status(400).json({ message: "Please complete all required fields." });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ message: "Please enter a valid email." });
    }

    const payload = buildPayload(req, "support", {
      name,
      email,
      category,
      message,
    });

    const sent = await notifyLeadInbox(payload);
    if (!sent && process.env.NODE_ENV === "production") {
      return res.status(503).json({
        message: "Unable to send your message right now. Please email support@caretip.de.",
      });
    }

    return res.status(201).json({ ok: true, leadId: `support_${Date.now()}` });
  } catch (err) {
    logServerError("lead.support", err);
    return res.status(500).json({ message: clientSafeMessage(err, CLIENT_FALLBACK.generic) });
  }
}
