/**
 * Facebook OAuth redirect START diagnostics — safe metadata only (no tokens, state, cookies, PII).
 */

const LOG_PREFIX = "[CareTip:FacebookOAuth]";
const SESSION_FAILURE_KEY = "caretip_fb_oauth_start_last_failure";

export type FacebookOAuthStartFlow = "signup" | "signin" | "link";

export type FacebookOAuthStartFailureType =
  | "csp_form_action_blocked"
  | "form_submit_exception"
  | "client_start_aborted"
  | "unknown";

export type FacebookOAuthStartEnvironment = "development" | "production";

export function facebookOAuthStartEnvironment(): FacebookOAuthStartEnvironment {
  return import.meta.env.PROD ? "production" : "development";
}

export function resolveFacebookOAuthStartFlow(
  context: { isLogin: boolean },
  endpoint: string,
): FacebookOAuthStartFlow {
  if (endpoint.includes("/start/link")) return "link";
  return context.isLogin ? "signin" : "signup";
}

export function sanitizeOAuthRedirectTarget(url: string): string {
  try {
    const u = new URL(url, typeof window !== "undefined" ? window.location.origin : "https://example.com");
    return `${u.origin}${u.pathname}`;
  } catch {
    return "[invalid-url]";
  }
}

export function redactSearchParams(search: string): string {
  if (!search || search === "?") return "";
  return "?[redacted]";
}

export function logFacebookOAuthStart(
  event: string,
  data: Record<string, unknown>,
): void {
  const payload = {
    stage: "facebook_oauth_start",
    event,
    at: new Date().toISOString(),
    ...data,
  };
  try {
    if (event.includes("FAILURE") || event.includes("EXCEPTION")) {
      console.error(LOG_PREFIX, event, payload);
    } else {
      console.info(LOG_PREFIX, event, payload);
    }
  } catch {
    /* ignore */
  }
}

export function storeFacebookOAuthStartFailure(diag: Record<string, unknown>): void {
  try {
    sessionStorage.setItem(SESSION_FAILURE_KEY, JSON.stringify({ ...diag, storedAt: new Date().toISOString() }));
  } catch {
    /* ignore */
  }
}

export function consumeFacebookOAuthStartFailure(): Record<string, unknown> | null {
  try {
    const raw = sessionStorage.getItem(SESSION_FAILURE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(SESSION_FAILURE_KEY);
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function baseFacebookOAuthStartFields(
  correlationId: string,
  flow: FacebookOAuthStartFlow,
  requestUrl: string,
): Record<string, unknown> {
  return {
    correlationId,
    requestId: correlationId,
    flow,
    environment: facebookOAuthStartEnvironment(),
    origin: typeof window !== "undefined" ? window.location.origin : undefined,
    pathname: typeof window !== "undefined" ? window.location.pathname : undefined,
    requestUrl,
    method: "POST",
    transport: "browser_form_post",
    responseObservableInJs: false,
  };
}
