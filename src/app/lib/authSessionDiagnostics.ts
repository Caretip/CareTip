/**
 * Opt-in auth session diagnostics (DEV or localStorage `caretip_auth_debug=1`).
 * Never logs tokens, cookies, or secrets — reason codes only.
 */
const LAST_DIAGNOSTIC_KEY = "caretip_auth_last_diagnostic";

function diagnosticsEnabled(): boolean {
  try {
    if (typeof import.meta !== "undefined" && import.meta.env?.DEV) return true;
    return localStorage.getItem("caretip_auth_debug") === "1";
  } catch {
    return false;
  }
}

export function recordAuthSessionDiagnostic(
  code:
    | "AUTH_SESSION_INVALIDATION_REASON"
    | "AUTH_REFRESH_FAILURE_CLASS"
    | "AUTH_BOOTSTRAP_REDIRECT_REASON"
    | "AUTH_LOGOUT_REASON"
    | "AUTH_API_401_OUTCOME",
  detail?: Record<string, unknown>,
): void {
  if (!diagnosticsEnabled()) return;
  try {
    const payload = { code, at: Date.now(), ...(detail ?? {}) };
    sessionStorage.setItem(LAST_DIAGNOSTIC_KEY, JSON.stringify(payload));
    console.info("[CareTip:auth-diag]", code, detail ?? {});
  } catch {
    // ignore
  }
}

export function readLastAuthSessionDiagnostic(): Record<string, unknown> | null {
  try {
    const raw = sessionStorage.getItem(LAST_DIAGNOSTIC_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}
