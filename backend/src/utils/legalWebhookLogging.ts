import type { Request } from "express";
import { LegalDocumentType } from "@prisma/client";
import type { LegalDocumentDto } from "../services/legalDocument.service.js";
import { logServerError } from "./httpErrors.js";

const LOG_PREFIX = "[legal.webhook]";

const TYPE_LABELS: Record<LegalDocumentType, string> = {
  [LegalDocumentType.privacy_policy]: "privacy",
  [LegalDocumentType.terms_conditions]: "terms",
  [LegalDocumentType.impressum]: "impressum",
};

function clientIp(req: Request): string {
  const ip = req.ip?.trim();
  return ip && ip.length > 0 ? ip : "unknown";
}

function isoTimestamp(): string {
  return new Date().toISOString();
}

function requestPath(req: Request): string {
  return req.originalUrl || req.path;
}

/** Safe request metadata — never includes Authorization, body, or env secrets. */
function requestMeta(req: Request): Record<string, string> {
  const contentLength = req.get("content-length");
  return {
    timestamp: isoTimestamp(),
    method: req.method,
    path: requestPath(req),
    ip: clientIp(req),
    userAgent: req.get("user-agent")?.trim() || "unknown",
    ...(contentLength ? { contentLength } : {}),
  };
}

/** Log every incoming webhook request at middleware entry. */
export function logLegalWebhookIncoming(req: Request): void {
  const meta = requestMeta(req);
  console.info(`${LOG_PREFIX} Incoming ${meta.method} ${meta.path}`, meta);
}

export type LegalWebhookAuthFailureReason =
  | "Missing Authorization header"
  | "Invalid Bearer token"
  | "LEGAL_PROVIDER_TOKEN not configured";

/** Log authentication failures without logging tokens or Authorization headers. */
export function logLegalWebhookAuthFailure(reason: LegalWebhookAuthFailureReason, req: Request): void {
  const payload = {
    timestamp: isoTimestamp(),
    ip: clientIp(req),
    reason,
  };
  if (reason === "LEGAL_PROVIDER_TOKEN not configured") {
    console.error(`${LOG_PREFIX} Authentication failed`, payload);
  } else {
    console.warn(`${LOG_PREFIX} Authentication failed`, payload);
  }
}

/** Log successful document sync — metadata only, no HTML. */
export function logLegalWebhookSuccess(documents: LegalDocumentDto[], durationMs: number): void {
  const types = [...new Set(documents.map((doc) => TYPE_LABELS[doc.type] ?? doc.type))];
  const languages = [...new Set(documents.map((doc) => doc.language))];
  const versions = documents.map(
    (doc) => `${TYPE_LABELS[doc.type] ?? doc.type}:${doc.language}@${doc.version}`,
  );

  console.info(`${LOG_PREFIX} Sync successful`, {
    timestamp: isoTimestamp(),
    documentCount: documents.length,
    types,
    languages,
    versions,
    durationMs,
  });
}

/** Log processing failures with request context; reuses logServerError + Sentry. */
export function logLegalWebhookProcessingFailure(
  err: unknown,
  req: Request,
  status: number,
): void {
  const message = err instanceof Error ? err.message : "unknown";
  const meta = {
    timestamp: isoTimestamp(),
    endpoint: requestPath(req),
    method: req.method,
    ip: clientIp(req),
    status,
    message,
  };

  const error = err instanceof Error ? err : new Error(message);
  logServerError("legal.webhook", error, meta);
}
