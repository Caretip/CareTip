import { getApiAbsoluteUrl } from "@/app/lib/api";
import { beginFacebookOAuthDiagnostic } from "@/app/lib/facebookOAuthDiagnostic";

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

function navigateToFacebookStartFailure(): void {
  const path = `/auth/facebook/complete?error=${FACEBOOK_OAUTH_START_FAILED_ERROR}`;
  window.location.assign(path);
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
  const correlationId = context.correlationId ?? beginFacebookOAuthDiagnostic();
  const form = document.createElement("form");
  form.method = "POST";
  // Same-origin path; Netlify/Vite proxies /api/* to the API host (CSP form-action 'self').
  form.action = getApiAbsoluteUrl(endpoint);
  form.style.display = "none";

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

  let violationListener: ((event: SecurityPolicyViolationEvent) => void) | undefined;
  const releaseSubmitFailureHook = () => {
    if (violationListener) {
      document.removeEventListener("securitypolicyviolation", violationListener);
      violationListener = undefined;
    }
  };
  const notifySubmitFailed = () => {
    releaseSubmitFailureHook();
    form.remove();
    navigateToFacebookStartFailure();
    onSubmitFailed?.();
  };

  if (onSubmitFailed) {
    violationListener = (event: SecurityPolicyViolationEvent) => {
      if (event.effectiveDirective !== "form-action") return;
      if (!event.blockedURI.includes("/api/auth/facebook/start")) return;
      notifySubmitFailed();
    };
    document.addEventListener("securitypolicyviolation", violationListener);
  }

  document.body.appendChild(form);
  try {
    form.submit();
  } catch {
    notifySubmitFailed();
  }
}
