import type { RequestHandler } from "express";
import { LegalDocumentType, Prisma } from "@prisma/client";
import {
  getLatestLegalDocument,
  upsertLegalDocumentsFromWebhook,
} from "../services/legalDocument.service.js";
import {
  buildItRechtXmlResponse,
  buildItRechtAuthErrorXml,
} from "../services/itRechtKanzlei/itRechtKanzleiXmlBuilder.js";
import {
  itRechtErrorCodeFromUnknown,
  itRechtErrorMessageFromUnknown,
  isLegalProviderConfigured,
  processItRechtXmlRequest,
} from "../services/itRechtKanzlei/itRechtKanzleiWebhook.service.js";
import { IT_RECHT_ERROR_MESSAGES } from "../services/itRechtKanzlei/itRechtKanzlei.types.js";
import type { ItRechtAction, ItRechtApiRequest } from "../services/itRechtKanzlei/itRechtKanzlei.types.js";
import {
  parseItRechtXmlPayload,
  resolveItRechtAction,
} from "../services/itRechtKanzlei/itRechtKanzleiXmlParser.js";
import { extractLegalWebhookXmlBody } from "../middleware/legalWebhookBody.middleware.js";
import { clientSafeMessage, CLIENT_FALLBACK, logServerError } from "../utils/httpErrors.js";
import {
  logItRechtAuthFailure,
  logItRechtAuthSuccess,
  logItRechtPushCompleted,
  logItRechtXmlError,
  logItRechtXmlIncoming,
  logLegalWebhookIncoming,
  logLegalWebhookProcessingFailure,
  logLegalWebhookSuccess,
  resolveItRechtAuthFailureReason,
  resolveLegalWebhookRequestId,
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

function sendXml(res: Parameters<RequestHandler>[1], xml: string): void {
  res.status(200).type("text/xml; charset=utf-8").send(xml);
}

function tryParseItRechtRequest(rawXml: string): {
  parsed?: ItRechtApiRequest;
  action?: ItRechtAction | null;
  parseFailed: boolean;
} {
  try {
    const parsed = parseItRechtXmlPayload(rawXml);
    return { parsed, action: resolveItRechtAction(parsed), parseFailed: false };
  } catch {
    return { parseFailed: true };
  }
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

async function handleItRechtXmlWebhook(req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1]): Promise<void> {
  const startedAt = Date.now();
  const requestId = resolveLegalWebhookRequestId(req);
  const rawXml = extractLegalWebhookXmlBody(req);

  if (!rawXml) {
    logItRechtXmlIncoming(req, { requestId, parseFailed: true });
    logItRechtXmlError(12, requestId);
    sendXml(
      res,
      buildItRechtXmlResponse({
        status: "error",
        error: 12,
        errorMessage: IT_RECHT_ERROR_MESSAGES[12]!,
      }),
    );
    return;
  }

  const preview = tryParseItRechtRequest(rawXml);
  logItRechtXmlIncoming(req, {
    requestId,
    parsed: preview.parsed,
    action: preview.action,
    parseFailed: preview.parseFailed,
  });

  if (!isLegalProviderConfigured()) {
    logItRechtAuthFailure(
      resolveItRechtAuthFailureReason(preview.parsed, false),
      requestId,
      preview.action,
    );
    logItRechtXmlError(3, requestId, { action: preview.action });
    sendXml(res, buildItRechtAuthErrorXml());
    return;
  }

  try {
    const response = await processItRechtXmlRequest(rawXml);
    const action = preview.action ?? preview.parsed?.action ?? "unknown";
    const durationMs = Date.now() - startedAt;

    if (response.status === "error" && response.error === 3) {
      logItRechtAuthFailure(resolveItRechtAuthFailureReason(preview.parsed, true), requestId, action);
      logItRechtXmlError(3, requestId, { action });
    } else if (response.status === "error" && response.error === 1) {
      logItRechtXmlError(1, requestId, { action });
    } else if (response.status === "error" && response.error === 10) {
      logItRechtAuthSuccess(action, requestId);
      logItRechtXmlError(10, requestId, { action });
    } else if (response.status === "error" && response.error) {
      logItRechtAuthSuccess(action, requestId);
      logItRechtXmlError(response.error, requestId, { action });
    } else {
      logItRechtAuthSuccess(action, requestId);
      if (response.pushAudit) {
        logItRechtPushCompleted(response.pushAudit, durationMs, requestId);
      }
    }

    sendXml(res, buildItRechtXmlResponse(response));
  } catch (err) {
    const action = preview.action ?? preview.parsed?.action ?? "unknown";
    const errorCode = itRechtErrorCodeFromUnknown(err);

    if (errorCode === 12) {
      logItRechtXmlError(12, requestId, { action, err });
    } else {
      logItRechtAuthSuccess(action, requestId);
      logItRechtXmlError(errorCode, requestId, { action, err });
    }

    logLegalWebhookProcessingFailure(err, req, 200);
    sendXml(
      res,
      buildItRechtXmlResponse({
        status: "error",
        error: errorCode,
        errorMessage: itRechtErrorMessageFromUnknown(err),
      }),
    );
  }
}

async function handleJsonWebhook(req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1]): Promise<void> {
  const startedAt = Date.now();
  logLegalWebhookIncoming(req);
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
}

export const postLegalWebhook: RequestHandler = async (req, res) => {
  const rawXml = extractLegalWebhookXmlBody(req);
  if (rawXml) {
    await handleItRechtXmlWebhook(req, res);
    return;
  }
  await handleJsonWebhook(req, res);
};
