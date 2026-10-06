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

export function beginFacebookOAuthDiagnostic(): string {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? `fb_web_${crypto.randomUUID()}`
      : `fb_web_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  activeDiagnosticId = id;
  return id;
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
