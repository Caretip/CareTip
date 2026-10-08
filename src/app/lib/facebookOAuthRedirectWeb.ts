import {
  getAuthCredentialExchangeTimeoutMs,
  shouldFailFacebookStartForStall,
} from "@/app/lib/authCredentialExchangeDeadline";
import { beginFacebookOAuthDiagnostic } from "@/app/lib/facebookOAuthDiagnostic";
import {
  baseFacebookOAuthStartFields,
  logFacebookOAuthStart,
  resolveFacebookOAuthStartFlow,
  storeFacebookOAuthStartFailure,
  type FacebookOAuthStartFailureType,
} from "@/app/lib/facebookOAuthStartObservability";

export type FacebookRedirectStartContext = {
  isLogin: boolean;
  returnPath: string;
  intendedRole?: "MANAGER" | "EMPLOYEE";
  name?: string;
  inviteCode?: string;
  businessName?: string;
  businessType?: string;
  location?: string;
  merchantLegalAccepted?: boolean;
  locale?: string;
  correlationId?: string;
};

/** Query param on /auth/facebook/complete when the browser cannot submit Facebook start. */
export const FACEBOOK_OAUTH_START_FAILED_ERROR = "start_failed";

/** Keep aligned with scripts/spa-csp-policy.mjs SPA_FACEBOOK_FORM_ACTION_SRC (minus 'self'). */
const FACEBOOK_OAUTH_FORM_ACTION_ORIGINS = new Set([
  "https://www.facebook.com",
  "https://m.facebook.com",
  "https://web.facebook.com",
  "https://facebook.com",
]);

/** Wait for redirect-chain CSP violations before treating submit as committed. */
const FACEBOOK_START_CSP_WINDOW_MS = 5_000;

const FACEBOOK_START_FORM_MARKER = "data-caretip-fb-oauth-start";

/** Tear down any prior attempt's document listener (no navigation). */
let releasePriorFacebookStartViolationHook: (() => void) | null = null;

/** Monotonic id so late CSP events cannot fail a newer or already-committed attempt. */
let facebookOAuthStartAttemptSeq = 0;

/** Default: redirect. Set VITE_FACEBOOK_OAUTH_MODE=sdk to keep JS SDK popup flow. */
export function isFacebookOAuthRedirectEnabled(): boolean {
  const mode = import.meta.env.VITE_FACEBOOK_OAUTH_MODE?.trim().toLowerCase();
  return mode !== "sdk";
}

function appendHidden(form: HTMLFormElement, name: string, value: string | undefined): void {
  if (value == null || value === "") return;
  const input = document.createElement("input");
  input.type = "hidden";
  input.name = name;
  input.value = value;
  form.appendChild(input);
}

function sanitizeBlockedOrigin(blockedURI: string): string {
  try {
    return new URL(blockedURI.trim(), window.location.origin).origin;
  } catch {
    return "[invalid]";
  }
}

function navigateToFacebookStartFailure(diag: Record<string, unknown>): void {
  logFacebookOAuthStart("NAVIGATING_TO_START_FAILURE", diag);
  storeFacebookOAuthStartFailure(diag);
  const path = `/auth/facebook/complete?error=${FACEBOOK_OAUTH_START_FAILED_ERROR}`;
  window.location.assign(path);
}

/** Same-origin path only — Vite/Netlify proxy /api; must not use VITE_API_URL (CSP form-action 'self'). */
function facebookOAuthStartFormAction(
  endpoint: "/api/auth/facebook/start" | "/api/auth/facebook/start/link",
): string {
  return endpoint;
}

function resolveExpectedFormActionPath(
  endpoint: "/api/auth/facebook/start" | "/api/auth/facebook/start/link",
): string {
  return endpoint;
}

/** Same-origin POST target blocked before leaving CareTip. */
function blockedUriMatchesFacebookStartForm(
  blockedURI: string,
  expectedPath: string,
): boolean {
  const trimmed = blockedURI.trim();
  if (!trimmed) return false;
  try {
    const blocked = new URL(trimmed, window.location.origin);
    const expected = new URL(expectedPath, window.location.origin);
    return blocked.origin === expected.origin && blocked.pathname === expected.pathname;
  } catch {
    return false;
  }
}

/** 302 redirect chain blocked (e.g. form-action 'self' only in Chromium). */
function blockedUriMatchesFacebookOAuthRedirect(blockedURI: string): boolean {
  return FACEBOOK_OAUTH_FORM_ACTION_ORIGINS.has(sanitizeBlockedOrigin(blockedURI));
}

function blockedUriMatchesCurrentFacebookStartAttempt(
  blockedURI: string,
  expectedFormPath: string,
): boolean {
  return (
    blockedUriMatchesFacebookStartForm(blockedURI, expectedFormPath) ||
    blockedUriMatchesFacebookOAuthRedirect(blockedURI)
  );
}

/**
 * Full-page POST navigation to the API start endpoint (preserves signup/login body, no popup).
 * The browser follows the server's 302 redirect to Facebook — do not use fetch + manual redirect.
 */
export function submitFacebookOAuthRedirectStart(
  context: FacebookRedirectStartContext,
  endpoint: "/api/auth/facebook/start" | "/api/auth/facebook/start/link",
  onSubmitFailed?: () => void,
): void {
  releasePriorFacebookStartViolationHook?.();
  releasePriorFacebookStartViolationHook = null;

  const attemptId = ++facebookOAuthStartAttemptSeq;
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  const correlationId = context.correlationId ?? beginFacebookOAuthDiagnostic();
  const flow = resolveFacebookOAuthStartFlow(context, endpoint);
  const requestUrl = endpoint;
  const expectedFormPath = resolveExpectedFormActionPath(endpoint);
  const base = baseFacebookOAuthStartFields(correlationId, flow, requestUrl);

  logFacebookOAuthStart("START_CLICKED", {
    ...base,
    attemptId,
    isLogin: context.isLogin,
    returnPath: context.returnPath,
    intendedRole: context.intendedRole ?? null,
    merchantLegalAccepted: context.merchantLegalAccepted ?? false,
    hasInviteCode: Boolean(context.inviteCode?.trim()),
    hasSignupName: Boolean(context.name?.trim()),
  });

  const form = document.createElement("form");
  form.method = "POST";
  form.action = facebookOAuthStartFormAction(endpoint);
  form.style.display = "none";
  form.setAttribute(FACEBOOK_START_FORM_MARKER, correlationId);

  appendHidden(form, "correlationId", correlationId);
  appendHidden(form, "isLogin", context.isLogin ? "true" : "false");
  appendHidden(form, "returnPath", context.returnPath);
  appendHidden(form, "locale", context.locale);
  appendHidden(form, "intendedRole", context.intendedRole);
  appendHidden(form, "name", context.name);
  appendHidden(form, "inviteCode", context.inviteCode);
  appendHidden(form, "businessName", context.businessName);
  appendHidden(form, "businessType", context.businessType);
  appendHidden(form, "location", context.location);
  if (context.merchantLegalAccepted) {
    appendHidden(form, "merchantLegalAccepted", "true");
  }
  if (endpoint.includes("/start/link")) {
    appendHidden(form, "flow", "link");
  }

  const elapsedMs = () =>
    Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt);

  let submitCommitted = false;
  let failureHandled = false;
  let navigationLeft = false;
  let attemptWindowTimer: ReturnType<typeof setTimeout> | undefined;
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  let onPageHide: (() => void) | undefined;
  let onVisibility: (() => void) | undefined;

  const failStart = (
    failureType: FacebookOAuthStartFailureType,
    reason: string,
    extra: Record<string, unknown> = {},
  ) => {
    if (attemptId !== facebookOAuthStartAttemptSeq || submitCommitted || failureHandled) {
      logFacebookOAuthStart("START_FAILURE_IGNORED", {
        ...base,
        attemptId,
        currentAttemptId: facebookOAuthStartAttemptSeq,
        submitCommitted,
        failureHandled,
        failureType,
        reason,
        ...extra,
      });
      return;
    }
    failureHandled = true;
    const diag = {
      ...base,
      attemptId,
      failureType,
      reason,
      elapsedMs: elapsedMs(),
      ...extra,
    };
    logFacebookOAuthStart("START_FAILURE", diag);
    teardownAttemptHooks();
    form.remove();
    navigateToFacebookStartFailure(diag);
    onSubmitFailed?.();
  };

  let violationListener: ((event: SecurityPolicyViolationEvent) => void) | undefined;
  const releaseSubmitFailureHook = () => {
    if (violationListener) {
      document.removeEventListener("securitypolicyviolation", violationListener);
      violationListener = undefined;
    }
  };

  const teardownAttemptHooks = () => {
    if (attemptWindowTimer !== undefined) {
      clearTimeout(attemptWindowTimer);
      attemptWindowTimer = undefined;
    }
    if (stallTimer !== undefined) {
      clearTimeout(stallTimer);
      stallTimer = undefined;
    }
    if (onPageHide) {
      window.removeEventListener("pagehide", onPageHide);
      onPageHide = undefined;
    }
    if (onVisibility) {
      document.removeEventListener("visibilitychange", onVisibility);
      onVisibility = undefined;
    }
    releaseSubmitFailureHook();
  };

  const markAttemptCommitted = () => {
    if (attemptId !== facebookOAuthStartAttemptSeq || failureHandled) return;
    submitCommitted = true;
    teardownAttemptHooks();
  };

  violationListener = (event: SecurityPolicyViolationEvent) => {
    if (attemptId !== facebookOAuthStartAttemptSeq || submitCommitted || failureHandled) return;
    if (event.effectiveDirective !== "form-action") return;
    if (!blockedUriMatchesCurrentFacebookStartAttempt(event.blockedURI, expectedFormPath)) return;

    const blockedOrigin = sanitizeBlockedOrigin(event.blockedURI);
    const isFacebookRedirect = blockedUriMatchesFacebookOAuthRedirect(event.blockedURI);
    failStart(
      "csp_form_action_blocked",
      isFacebookRedirect ? "csp_blocked_facebook_redirect" : "csp_blocked_form_action",
      {
        blockedOrigin,
        expectedFormPath,
        violatedDirective: event.violatedDirective,
        effectiveDirective: event.effectiveDirective,
        disposition: event.disposition,
      },
    );
  };
  document.addEventListener("securitypolicyviolation", violationListener);
  releasePriorFacebookStartViolationHook = teardownAttemptHooks;

  onPageHide = () => {
    navigationLeft = true;
    markAttemptCommitted();
  };
  window.addEventListener("pagehide", onPageHide);
  attemptWindowTimer = setTimeout(() => {
    if (navigationLeft) markAttemptCommitted();
  }, FACEBOOK_START_CSP_WINDOW_MS);
  stallTimer = setTimeout(() => {
    const failIfStillHere = () => {
      if (
        !shouldFailFacebookStartForStall({
          navigationLeft,
          failureHandled,
        })
      ) {
        return;
      }
      failStart("client_start_aborted", "redirect_navigation_stalled", {
        elapsedMs: elapsedMs(),
      });
    };
    if (document.visibilityState === "hidden") {
      onVisibility = () => {
        if (document.visibilityState !== "visible") return;
        failIfStillHere();
      };
      document.addEventListener("visibilitychange", onVisibility);
      return;
    }
    failIfStillHere();
  }, getAuthCredentialExchangeTimeoutMs());

  logFacebookOAuthStart("START_REQUEST", {
    ...base,
    attemptId,
    formAction: form.action,
    expectedFormPath,
    elapsedMs: elapsedMs(),
    note:
      "Full-page form POST; HTTP status and Location are not available in JS. Inspect Network tab for POST response.",
  });

  document.body.appendChild(form);
  try {
    form.submit();
    form.remove();
    logFacebookOAuthStart("START_SUBMIT_INVOKED", {
      ...base,
      attemptId,
      elapsedMs: elapsedMs(),
      note: "If start succeeds, the document navigates away (expect 302 to Facebook in Network).",
    });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logFacebookOAuthStart("START_EXCEPTION", {
      ...base,
      attemptId,
      failureType: "form_submit_exception",
      reason: "form_submit_threw",
      elapsedMs: elapsedMs(),
      errorName: error.name,
      errorMessage: error.message,
      threw: true,
    });
    failStart("form_submit_exception", "form_submit_threw", {
      errorName: error.name,
      errorMessage: error.message,
    });
  }
}
