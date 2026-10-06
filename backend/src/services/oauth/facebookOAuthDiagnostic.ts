import type { Request } from "express";

export const FACEBOOK_OAUTH_DIAGNOSTIC_HEADER = "x-oauth-diagnostic-id";
export const FACEBOOK_OAUTH_LOG_PREFIX = "[oauth:facebook:diag]";

export type FacebookOAuthDiagnosticCase = "A" | "B" | "C" | "D" | "E" | "F" | "G";

export type FacebookOAuthDiagnosticStage =
  | "request_received"
  | "authenticate_entered"
  | "identity_verify_start"
  | "identity_verify_jwt"
  | "identity_verify_access_token"
  | "debug_token_response"
  | "graph_me_response"
  | "identity_verified"
  | "email_required"
  | "oauth_subject_lookup"
  | "oauth_subject_lookup_result"
  | "oauth_subject_missing"
  | "signup_blocked"
  | "login_blocked"
  | "session_complete"
  | "identity_verify_route"
  | "http_response"
  | "failure";

export function resolveFacebookOAuthDiagnosticId(req: Request): string {
  const fromHeader = req.get(FACEBOOK_OAUTH_DIAGNOSTIC_HEADER)?.trim();
  if (fromHeader && fromHeader.length > 0 && fromHeader.length <= 128) {
    return fromHeader;
  }
  return `fb_srv_${crypto.randomUUID()}`;
}

export function jsonFieldNames(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(value as Record<string, unknown>).sort();
}

export function logFacebookOAuthDiagnostic(
  correlationId: string,
  stage: FacebookOAuthDiagnosticStage,
  fields: Record<string, unknown> & {
    case?: FacebookOAuthDiagnosticCase;
    errorClass?: string;
    errorCode?: string;
  },
): void {
  const payload = {
    correlationId,
    stage,
    at: new Date().toISOString(),
    ...fields,
  };
  console.info(FACEBOOK_OAUTH_LOG_PREFIX, JSON.stringify(payload));
}

/** Log outbound OAuth HTTP result for Facebook (safe metadata only). */
export function logFacebookOAuthHttpResponse(
  correlationId: string | undefined,
  fields: {
    httpStatus: number;
    responseBranch: string;
    responseCode?: string;
    errorClass?: string;
  },
): void {
  if (!correlationId?.trim()) return;
  logFacebookOAuthDiagnostic(correlationId.trim(), "http_response", fields);
}
