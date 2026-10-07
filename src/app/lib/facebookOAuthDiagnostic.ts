/**
 * Temporary Facebook OAuth diagnostics — safe metadata only (no tokens, secrets, or email).
 */

const LOG_PREFIX = "[CareTip:oauth:facebook]";
const HEADER_NAME = "X-OAuth-Diagnostic-Id";

let activeDiagnosticId: string | null = null;

export type FacebookOAuthDiagnosticCase =
  | "A"
  | "B"
  | "C"
  | "D"
  | "E"
  | "F"
  | "G";

function newFacebookOAuthDiagnosticId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `fb_web_${crypto.randomUUID()}`
    : `fb_web_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function beginFacebookOAuthDiagnostic(): string {
  const id = newFacebookOAuthDiagnosticId();
  activeDiagnosticId = id;
  return id;
}

/** Bind an existing attempt id (e.g. created at button click) for API header continuity. */
export function setActiveFacebookOAuthDiagnosticId(correlationId: string): void {
  activeDiagnosticId = correlationId;
}

/** Restore diagnostic id for a late orphan token delivery after a rejected attempt. */
export function restoreFacebookOAuthDiagnosticId(correlationId: string): void {
  activeDiagnosticId = correlationId;
}

export function getFacebookOAuthDiagnosticId(): string | null {
  return activeDiagnosticId;
}

export function clearFacebookOAuthDiagnostic(): void {
  activeDiagnosticId = null;
}

export function facebookOAuthDiagnosticHeaderName(): string {
  return HEADER_NAME;
}

export function logFacebookOAuthDiagnostic(
  stage: string,
  data: Record<string, unknown> & { case?: FacebookOAuthDiagnosticCase },
): void {
  const correlationId = activeDiagnosticId ?? data.correlationId;
  const payload = {
    ...data,
    ...(correlationId ? { correlationId } : {}),
    stage,
    at: new Date().toISOString(),
  };
  try {
    console.info(LOG_PREFIX, payload);
  } catch {
    /* ignore */
  }
}
