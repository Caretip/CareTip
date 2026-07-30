import type { Request } from "express";

const LOG_PREFIX = "[legal.webhook]";

export type LegalWebhookAuthMethod =
  | "Authorization: Bearer"
  | "Authorization: raw"
  | "X-API-Key"
  | "X-Auth-Token";

export type LegalWebhookAuthFailureReason =
  | "Missing Authorization header"
  | "Missing X-API-Key"
  | "Invalid Bearer token"
  | "Invalid API key"
  | "LEGAL_PROVIDER_TOKEN not configured";

export type LegalWebhookAuthAttempt = {
  method: LegalWebhookAuthMethod;
  headerPresent: boolean;
  matched: boolean;
};

export type LegalWebhookAuthCandidates = {
  bearer?: string;
  authorizationRaw?: string;
  xApiKey?: string;
  xAuthToken?: string;
  hasAuthorizationHeader: boolean;
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

/** Header names only — never values. */
export function listIncomingHeaderNames(req: Request): string[] {
  return Object.keys(req.headers).sort();
}

export function resolveLegalWebhookRequestId(req: Request): string | undefined {
  return (
    req.get("x-request-id")?.trim() ||
    req.get("x-correlation-id")?.trim() ||
    req.get("cf-ray")?.trim() ||
    undefined
  );
}

// TODO: Remove after IT-Recht Kanzlei integration is verified.
/** Extended incoming log for IT-Recht Kanzlei integration debugging. */
export function logLegalWebhookDebugIncoming(req: Request): void {
  const headerNames = listIncomingHeaderNames(req);
  const hasAuthorizationHeader = headerNames.includes("authorization");
  console.info(`${LOG_PREFIX} Debug incoming request`, {
    timestamp: isoTimestamp(),
    method: req.method,
    path: requestPath(req),
    ip: clientIp(req),
    userAgent: req.get("user-agent")?.trim() || "unknown",
    headerNames,
    hasAuthorizationHeader,
    hasXApiKey: headerNames.includes("x-api-key"),
    hasXAuthToken: headerNames.includes("x-auth-token"),
    requestId: resolveLegalWebhookRequestId(req),
  });
}

// TODO: Remove after IT-Recht Kanzlei integration is verified.
export function extractLegalWebhookAuthCandidates(req: Request): LegalWebhookAuthCandidates {
  const authHeader = req.get("authorization")?.trim() ?? "";
  const hasAuthorizationHeader = authHeader.length > 0;

  let bearer: string | undefined;
  let authorizationRaw: string | undefined;

  if (authHeader) {
    const bearerMatch = /^Bearer\s+(.+)$/i.exec(authHeader);
    if (bearerMatch?.[1]?.trim()) {
      bearer = bearerMatch[1].trim();
    } else {
      authorizationRaw = authHeader;
    }
  }

  const xApiKey = req.get("x-api-key")?.trim() || undefined;
  const xAuthToken = req.get("x-auth-token")?.trim() || undefined;

  return {
    bearer,
    authorizationRaw,
    xApiKey,
    xAuthToken,
    hasAuthorizationHeader,
  };
}

// TODO: Remove after IT-Recht Kanzlei integration is verified.
export function resolveLegalWebhookAuth(
  req: Request,
  expected: string,
): { ok: true; method: LegalWebhookAuthMethod } | { ok: false; reason: LegalWebhookAuthFailureReason; attempts: LegalWebhookAuthAttempt[] } {
  const candidates = extractLegalWebhookAuthCandidates(req);

  const attempts: LegalWebhookAuthAttempt[] = [
    {
      method: "Authorization: Bearer",
      headerPresent: candidates.bearer !== undefined,
      matched: candidates.bearer === expected,
    },
    {
      method: "Authorization: raw",
      headerPresent: candidates.authorizationRaw !== undefined,
      matched: candidates.authorizationRaw === expected,
    },
    {
      method: "X-API-Key",
      headerPresent: candidates.xApiKey !== undefined,
      matched: candidates.xApiKey === expected,
    },
    {
      method: "X-Auth-Token",
      headerPresent: candidates.xAuthToken !== undefined,
      matched: candidates.xAuthToken === expected,
    },
  ];

  const matched = attempts.find((attempt) => attempt.matched);
  if (matched) {
    return { ok: true, method: matched.method };
  }

  const anyCredentialSent = attempts.some((attempt) => attempt.headerPresent);
  if (!anyCredentialSent) {
    return {
      ok: false,
      reason: candidates.hasAuthorizationHeader ? "Invalid Bearer token" : "Missing Authorization header",
      attempts,
    };
  }

  if (candidates.bearer !== undefined || candidates.authorizationRaw !== undefined) {
    return { ok: false, reason: "Invalid Bearer token", attempts };
  }

  if (candidates.xApiKey !== undefined || candidates.xAuthToken !== undefined) {
    return { ok: false, reason: "Invalid API key", attempts };
  }

  return { ok: false, reason: "Missing X-API-Key", attempts };
}

// TODO: Remove after IT-Recht Kanzlei integration is verified.
export function logLegalWebhookAuthSuccess(req: Request, method: LegalWebhookAuthMethod): void {
  console.info(`${LOG_PREFIX} Authentication successful`, {
    timestamp: isoTimestamp(),
    ip: clientIp(req),
    method,
    requestId: resolveLegalWebhookRequestId(req),
  });
}

// TODO: Remove after IT-Recht Kanzlei integration is verified.
export function logLegalWebhookAuthFailureDebug(
  req: Request,
  reason: LegalWebhookAuthFailureReason,
  attempts: LegalWebhookAuthAttempt[],
): void {
  const anyCredentialSent = attempts.some((attempt) => attempt.headerPresent);
  const payload = {
    timestamp: isoTimestamp(),
    ip: clientIp(req),
    reason,
    attemptedMethods: attempts.map((attempt) => ({
      method: attempt.method,
      headerPresent: attempt.headerPresent,
      matched: attempt.matched,
    })),
    anyCredentialSent,
    requestId: resolveLegalWebhookRequestId(req),
  };

  if (reason === "LEGAL_PROVIDER_TOKEN not configured") {
    console.error(`${LOG_PREFIX} Authentication failed`, payload);
  } else {
    console.warn(`${LOG_PREFIX} Authentication failed`, payload);
  }
}
