import type { RequestHandler } from "express";
import { LegalDocumentType, Prisma } from "@prisma/client";
import {
  getLatestLegalDocument,
  upsertLegalDocumentsFromWebhook,
} from "../services/legalDocument.service.js";
import { clientSafeMessage, CLIENT_FALLBACK, logServerError } from "../utils/httpErrors.js";
import {
  logLegalWebhookProcessingFailure,
  logLegalWebhookSuccess,
} from "../utils/legalWebhookLogging.js";

function resolveLanguage(req: { query: Record<string, unknown>; headers: Record<string, string | string[] | undefined> }): string | undefined {
  const q = req.query.lang ?? req.query.language ?? req.query.locale;
  if (typeof q === "string" && q.trim()) return q.trim();
  const accept = req.headers["accept-language"];
  if (typeof accept === "string") {
    const first = accept.split(",")[0]?.trim();
    if (first) return first.slice(0, 2);
  }
  return undefined;
}

function isLegalStoreUnavailable(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    (err.code === "P2021" || err.code === "P2022")
  );
}

async function sendLegalDocument(
  res: Parameters<RequestHandler>[1],
  type: LegalDocumentType,
  language?: string,
): Promise<void> {
  try {
    const doc = await getLatestLegalDocument(type, language);
    if (!doc) {
      res.status(404).json({ message: "Legal document is not available yet." });
      return;
    }
    res.json(doc);
  } catch (err) {
    if (isLegalStoreUnavailable(err)) {
      res.status(404).json({ message: "Legal document is not available yet." });
      return;
    }
    logServerError("legal.get", err, { type, language });
    res.status(500).json({ message: clientSafeMessage(err, CLIENT_FALLBACK.generic) });
  }
}

export const getPrivacyDocument: RequestHandler = async (req, res) => {
  await sendLegalDocument(res, LegalDocumentType.privacy_policy, resolveLanguage(req));
};

export const getTermsDocument: RequestHandler = async (req, res) => {
  await sendLegalDocument(res, LegalDocumentType.terms_conditions, resolveLanguage(req));
};

export const getImpressumDocument: RequestHandler = async (req, res) => {
  await sendLegalDocument(res, LegalDocumentType.impressum, resolveLanguage(req));
};

export const postLegalWebhook: RequestHandler = async (req, res) => {
  const startedAt = Date.now();
  try {
    const updated = await upsertLegalDocumentsFromWebhook(req.body);
    logLegalWebhookSuccess(updated, Date.now() - startedAt);
    res.status(200).json({
      ok: true,
      updated: updated.map((doc) => ({
        type: doc.type,
        language: doc.language,
        version: doc.version,
        updatedAt: doc.updatedAt,
      })),
    });
  } catch (err) {
    const status =
      typeof err === "object" && err !== null && "status" in err && typeof (err as { status: unknown }).status === "number"
        ? (err as { status: number }).status
        : 500;

    logLegalWebhookProcessingFailure(err, req, status);

    res.status(status).json({
      message: clientSafeMessage(err, CLIENT_FALLBACK.generic),
    });
  }
};
