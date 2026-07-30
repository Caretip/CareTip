import type { Request } from "express";
import { LegalDocumentType } from "@prisma/client";
import type { LegalDocumentDto } from "../services/legalDocument.service.js";
import { logServerError } from "./httpErrors.js";
import type {
  ItRechtAction,
  ItRechtApiRequest,
  ItRechtPushAudit,
  ItRechtXmlErrorCode,
} from "../services/itRechtKanzlei/itRechtKanzlei.types.js";
import {
  buildItRechtTokenAuthDiagnostics,
  type ItRechtTokenAuthDiagnostics,
} from "../services/itRechtKanzlei/itRechtKanzleiTokenAuth.js";

export const LOG_PREFIX = "[legal.webhook]";

const TYPE_LABELS: Record<LegalDocumentType, string> = {
  [LegalDocumentType.privacy_policy]: "privacy",
  [LegalDocumentType.terms_conditions]: "terms",
  [LegalDocumentType.impressum]: "impressum",
};

const SENSITIVE_LOG_KEYS = new Set([
  "userAuthToken",
  "userPassword",
  "rechtstextHtml",
  "rechtstextText",
  "rechtstextPdf",
  "contentHtml",
  "password",
  "token",
]);

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

/** Resolve correlation / request ID from inbound headers. */
export function resolveLegalWebhookRequestId(req: Request): string {
  return (
    req.get("x-request-id")?.trim() ||
    req.get("x-correlation-id")?.trim() ||
    req.get("cf-ray")?.trim() ||
    "unknown"
  );
}

/** Mask auth token for logs — never log full token. */
export function maskItRechtAuthToken(token?: string): string | undefined {
  if (!token?.trim()) return undefined;
  const trimmed = token.trim();
  if (trimmed.length <= 4) return "****";
  return `****${trimmed.slice(-4)}`;
}

/** Safe authenticated-user label for audit logs. */
export function formatItRechtAuthenticatedUser(request?: ItRechtApiRequest): string | undefined {
  if (!request) return undefined;
  if (request.userAuthToken?.trim()) {
    return `token:${maskItRechtAuthToken(request.userAuthToken)}`;
  }
  if (request.userUsername?.trim()) {
    return `user:${request.userUsername.trim()}`;
  }
  return undefined;
}

export type ItRechtAuthFailureReason =
  | "Missing user_auth_token"
  | "Invalid token"
  | "LEGAL_PROVIDER_TOKEN not configured";

/** Determine auth failure reason for logging (does not affect XML responses). */
export function resolveItRechtAuthFailureReason(
  request?: ItRechtApiRequest,
  configured = true,
): ItRechtAuthFailureReason {
  if (!configured) return "LEGAL_PROVIDER_TOKEN not configured";
  const hasToken = Boolean(request?.userAuthToken?.trim());
  const hasUsername = Boolean(request?.userUsername?.trim());
  if (!hasToken && !hasUsername) return "Missing user_auth_token";
  return "Invalid token";
}

export type ItRechtIncomingLogContext = {
  requestId: string;
  parsed?: ItRechtApiRequest;
  action?: ItRechtAction | null;
  parseFailed?: boolean;
};

/** Log every incoming IT-Recht XML request with safe metadata only. */
export function logItRechtXmlIncoming(req: Request, context: ItRechtIncomingLogContext): void {
  const { requestId, parsed, action, parseFailed } = context;
  const payload: Record<string, string | undefined> = {
    timestamp: isoTimestamp(),
    requestId,
    ip: clientIp(req),
    method: req.method,
    path: requestPath(req),
    action: action ?? parsed?.action ?? (parseFailed ? "unknown" : undefined),
    apiVersion: parsed?.apiVersion,
    authenticatedUser: formatItRechtAuthenticatedUser(parsed),
    accountId: parsed?.userAccountId,
    rechtstextType: parsed?.rechtstextType,
    language: parsed?.rechtstextLanguage,
    country: parsed?.rechtstextCountry,
  };

  console.info(`${LOG_PREFIX} Incoming XML request`, payload);
}

/** Log successful IT-Recht XML authentication. */
export function logItRechtAuthSuccess(action: ItRechtAction | string, requestId: string): void {
  console.info(`${LOG_PREFIX} Authentication successful`, {
    timestamp: isoTimestamp(),
    action,
    requestId,
  });
}

/** Log safe token comparison diagnostics on auth failure (never logs token values). */
export function logItRechtTokenAuthDiagnostics(
  requestId: string,
  receivedToken: string | undefined,
  action?: ItRechtAction | string | null,
): ItRechtTokenAuthDiagnostics {
  const diagnostics = buildItRechtTokenAuthDiagnostics(receivedToken);
  console.warn(`${LOG_PREFIX} Token auth diagnostics`, {
    timestamp: isoTimestamp(),
    requestId,
    ...(action ? { action } : {}),
    ...diagnostics,
  });
  return diagnostics;
}

/** Log IT-Recht XML authentication failure. */
export function logItRechtAuthFailure(
  reason: ItRechtAuthFailureReason,
  requestId: string,
  action?: ItRechtAction | string | null,
  receivedToken?: string,
): void {
  const payload = {
    timestamp: isoTimestamp(),
    reason,
    requestId,
    ...(action ? { action } : {}),
  };
  if (reason === "LEGAL_PROVIDER_TOKEN not configured") {
    console.error(`${LOG_PREFIX} Authentication failed`, {
      ...payload,
      envVar: "LEGAL_PROVIDER_TOKEN",
      expectedMissing: true,
    });
  } else {
    console.warn(`${LOG_PREFIX} Authentication failed`, payload);
    if (reason === "Invalid token" || reason === "Missing user_auth_token") {
      logItRechtTokenAuthDiagnostics(requestId, receivedToken, action);
    }
  }
}

/** Log completed push processing. */
export function logItRechtPushCompleted(audit: ItRechtPushAudit, durationMs: number, requestId: string): void {
  console.info(`${LOG_PREFIX} Push completed`, {
    timestamp: isoTimestamp(),
    requestId,
    type: audit.rechtstextType,
    language: audit.language,
    country: audit.country,
    accountId: audit.accountId,
    created: audit.created,
    updated: !audit.created,
    targetUrl: audit.targetUrl,
    durationMs,
  });
}

const XML_ERROR_LOG_LABELS: Partial<Record<ItRechtXmlErrorCode, string>> = {
  3: "Authentication failed",
  10: "Invalid action",
  12: "Malformed XML",
};

/** Log IT-Recht XML processing errors (server-side; never included in XML responses). */
export function logItRechtXmlError(
  errorCode: ItRechtXmlErrorCode,
  requestId: string,
  options?: {
    action?: ItRechtAction | string | null;
    err?: unknown;
  },
): void {
  const label = XML_ERROR_LOG_LABELS[errorCode] ?? "Processing error";
  const payload: Record<string, unknown> = {
    timestamp: isoTimestamp(),
    requestId,
    errorCode,
    ...(options?.action ? { action: options.action } : {}),
  };

  if (errorCode === 12) {
    console.warn(`${LOG_PREFIX} ${label}`, payload);
  } else if (errorCode === 3 || errorCode === 10) {
    console.warn(`${LOG_PREFIX} ${label}`, { ...payload, message: `Error Code: ${errorCode}` });
  } else {
    console.warn(`${LOG_PREFIX} ${label}`, payload);
  }

  if (options?.err) {
    const error = options.err instanceof Error ? options.err : new Error(String(options.err));
    logServerError("legal.webhook.xml", error, {
      requestId,
      errorCode,
      action: options.action ?? undefined,
    });
  }
}

/** Assert log payload does not contain sensitive legal/auth content (for tests). */
export function assertLogPayloadIsSafe(value: unknown, path = "root"): void {
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
    if (value.includes("<p>") || value.includes("JVBERi0") || value.length > 500) {
      throw new Error(`Unsafe log string at ${path}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertLogPayloadIsSafe(item, `${path}[${index}]`));
    return;
  }
  if (typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_LOG_KEYS.has(key)) {
        throw new Error(`Sensitive log key ${key} at ${path}`);
      }
      assertLogPayloadIsSafe(nested, `${path}.${key}`);
    }
  }
}

/** Log legacy JSON webhook requests. */
export function logLegalWebhookIncoming(req: Request): void {
  console.info(`${LOG_PREFIX} Incoming ${req.method} ${requestPath(req)}`, {
    timestamp: isoTimestamp(),
    method: req.method,
    path: requestPath(req),
    ip: clientIp(req),
  });
}

export type LegalWebhookJsonAuthFailureReason =
  | "Missing Authorization header"
  | "Invalid Bearer token"
  | "LEGAL_PROVIDER_TOKEN not configured";

/** Log legacy JSON Bearer auth failures. */
export function logLegalWebhookJsonAuthFailure(reason: LegalWebhookJsonAuthFailureReason, req: Request): void {
  const payload = {
    timestamp: isoTimestamp(),
    ip: clientIp(req),
    reason,
  };
  if (reason === "LEGAL_PROVIDER_TOKEN not configured") {
    console.error(`${LOG_PREFIX} JSON authentication failed`, payload);
  } else {
    console.warn(`${LOG_PREFIX} JSON authentication failed`, payload);
  }
}

/** @deprecated Use logItRechtAuthFailure */
export function logLegalWebhookXmlAuthFailure(
  reason: "Invalid authentication token" | "LEGAL_PROVIDER_TOKEN not configured",
  req: Request,
): void {
  const mapped: ItRechtAuthFailureReason =
    reason === "LEGAL_PROVIDER_TOKEN not configured"
      ? "LEGAL_PROVIDER_TOKEN not configured"
      : "Invalid token";
  logItRechtAuthFailure(mapped, resolveLegalWebhookRequestId(req));
}

/** @deprecated Use logItRechtAuthSuccess */
export function logLegalWebhookXmlAuthSuccess(req: Request): void {
  logItRechtAuthSuccess("api", resolveLegalWebhookRequestId(req));
}

/** @deprecated Use logItRechtXmlIncoming */
export function logLegalWebhookXmlIncoming(req: Request): void {
  logItRechtXmlIncoming(req, { requestId: resolveLegalWebhookRequestId(req) });
}

/** Log successful JSON document sync — metadata only, no HTML. */
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
    requestId: resolveLegalWebhookRequestId(req),
  };

  const error = err instanceof Error ? err : new Error(message);
  logServerError("legal.webhook", error, meta);
}
