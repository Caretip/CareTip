import { normalizeApiError } from "@/types/api";
import { EMAIL_NOT_VERIFIED } from "@/constants/authErrors";

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

const TECHNICAL_PATTERNS = [
  /request failed with status code/i,
  /network error/i,
  /axioserror/i,
  /err_network/i,
  /econnrefused/i,
  /enotfound/i,
  /etimedout/i,
  /econnaborted/i,
  /timeout of \d+ms exceeded/i,
  /could not reach the caretip api/i,
  /\bprisma\b/i,
  /\bsql\b/i,
  /\bstack\b/i,
  /\bexception\b/i,
  /\binternal server error\b/i,
  /\bforbidden\b/i,
  /\bunauthorized\b/i,
  /\bstatus code\b/i,
  /oauthaccountnotfound/i,
  /oauth_account_not_registered/i,
  /google_account_not_registered/i,
  /oauth_linking_required/i,
  /https?:\/\//i,
  /\/api\//i,
  /\{["']?\w+["']?:/,
];

/** Backend/API codes → i18n keys (stable contract). */
const CODE_TO_I18N: Record<string, string> = {
  AUTH_REQUIRED: "errors.unauthorized",
  UNAUTHORIZED: "errors.unauthorized",
  INVALID_CREDENTIALS: "auth.invalidCredentials",
  INVALID_PASSWORD: "auth.invalidCredentials",
  EMAIL_NOT_VERIFIED: "auth.emailNotVerifiedError",
  ACCOUNT_PENDING_VERIFICATION: "auth.emailNotVerifiedError",
  MFA_REQUIRED: "auth.mfaFailed",
  MFA_INVALID: "auth.mfaFailed",
  INVALID_MFA_CODE: "auth.mfaFailed",
  RATE_LIMITED: "errors.rateLimited",
  TOO_MANY_REQUESTS: "errors.rateLimited",
  SUBSCRIPTION_REQUIRED: "errors.subscriptionRequiredBody",
  PLAN_LIMIT_EXCEEDED: "errors.planLimitExceeded",
  ONBOARDING_INCOMPLETE: "errors.onboardingIncompleteBody",
  FORBIDDEN: "errors.forbidden",
  INSUFFICIENT_PERMISSIONS: "errors.forbidden",
  NOT_FOUND: "errors.notFound",
  VALIDATION_ERROR: "errors.validation",
  BAD_REQUEST: "errors.validation",
  CONFLICT: "errors.conflict",
  SERVICE_UNAVAILABLE: "errors.unavailable",
  INTERNAL_ERROR: "errors.server",
  BILLING_SESSION_MISSING: "billingHandoff.openFailed",
  OAUTH_ACCOUNT_NOT_REGISTERED: "auth.oauthAccountNotRegistered",
  GOOGLE_ACCOUNT_NOT_REGISTERED: "auth.oauthAccountNotRegistered",
  OAUTH_LINKING_REQUIRED: "auth.oauthLinkingRequired",
  OAUTH_EMAIL_REQUIRED: "auth.oauthEmailRequired",
  OAUTH_TOKEN_VERIFICATION_FAILED: "auth.oauthTokenInvalid",
  GOOGLE_TOKEN_VERIFICATION_FAILED: "auth.oauthTokenInvalid",
};

/** Known English server messages → same keys (when code is missing). */
const MESSAGE_TO_I18N: Record<string, string> = {
  "insufficient permissions": "errors.forbidden",
  "authentication required": "errors.unauthorized",
  "account pending verification": "auth.emailNotVerifiedError",
  "email verification required": "auth.emailNotVerifiedError",
  "business context required": "errors.businessContextRequired",
  "employee not found": "errors.notFound",
  "branded qr not found": "qr.brandedNotFound",
  "invalid credentials": "auth.invalidCredentials",
  "invalid email or password": "auth.invalidCredentials",
  "incorrect email or password": "auth.invalidCredentials",
  "wrong password": "auth.invalidCredentials",
  "user not found": "auth.invalidCredentials",
  "too many requests": "errors.rateLimited",
  "rate limit exceeded": "errors.rateLimited",
  "subscription is required": "errors.subscriptionRequiredBody",
  "plan limit exceeded": "errors.planLimitExceeded",
  "complete onboarding": "errors.onboardingIncompleteBody",
  "network error": "errors.offline",
  "internal server error": "errors.server",
  "forbidden": "errors.forbidden",
  "unauthorized": "errors.unauthorized",
  "not found": "errors.notFound",
  "something went wrong. please try again.": "errors.generic",
  "share_export_unavailable": "settings.menu.exportError",
  "share export unavailable": "settings.menu.exportError",
};

function isTechnicalMessage(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return true;
  if (/^\d{3}$/.test(trimmed)) return true;
  if (/^\d{3}\s/.test(trimmed)) return true;
  if (TECHNICAL_PATTERNS.some((re) => re.test(trimmed))) return true;
  if (trimmed.includes(" at ") && /\.(ts|js|tsx|jsx)\b/i.test(trimmed)) return true;
  return false;
}

function resolveMessageKey(raw: string): string | null {
  const key = MESSAGE_TO_I18N[raw.trim().toLowerCase()];
  return key ?? null;
}

/** Subscription/plan entitlement denial — not a role permission failure. */
export function isSubscriptionRequiredError(error: unknown): boolean {
  if (!error) return false;
  const normalized = normalizeApiError(error);
  if (normalized.code === "SUBSCRIPTION_REQUIRED") return true;
  if (normalized.code === "PLAN_LIMIT_EXCEEDED") return true;
  const raw =
    typeof error === "string"
      ? error
      : normalized.message || "";
  return /subscription is required|plan limit/i.test(raw);
}

export function isOnboardingIncompleteError(error: unknown): boolean {
  if (!error) return false;
  const normalized = normalizeApiError(error);
  if (normalized.code === "ONBOARDING_INCOMPLETE") return true;
  const raw =
    typeof error === "string"
      ? error
      : normalized.message || "";
  return /complete onboarding/i.test(raw);
}

export function isAuthenticationError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === "string") {
    return /authentication required|unauthorized|sign in again/i.test(error);
  }
  const normalized = normalizeApiError(error);
  if (normalized.isUnauthorized || normalized.status === 401) return true;
  if (normalized.code === "AUTH_REQUIRED" || normalized.code === "UNAUTHORIZED") return true;
  return /authentication required/i.test(normalized.message || "");
}

export function isPermissionError(error: unknown): boolean {
  if (!error) return false;
  if (isSubscriptionRequiredError(error)) return false;
  if (isOnboardingIncompleteError(error)) return false;
  if (isAuthenticationError(error)) return false;
  if (typeof error === "string") {
    return (
      error === "Insufficient permissions" || /403|forbidden|permission/i.test(error)
    );
  }
  const normalized = normalizeApiError(error);
  if (normalized.status === 403) return true;
  if (normalized.code === "FORBIDDEN" || normalized.code === "INSUFFICIENT_PERMISSIONS") {
    return true;
  }
  const raw = normalized.message || "";
  return raw === "Insufficient permissions" || /forbidden|permission/i.test(raw);
}

/**
 * Global user-facing error formatter — never surfaces Axios/stack/raw HTTP text.
 * Prefer backend `code` → i18n; never pass through technical or unmapped server English.
 */
export function formatUserFacingError(
  error: unknown,
  fallback: string,
  t?: TranslateFn,
): string {
  const pick = (key: string) => (t ? t(key) : fallback);

  if (!error) return fallback;

  if (typeof error === "string") {
    if (isTechnicalMessage(error)) return fallback;
    const mapped = resolveMessageKey(error);
    if (mapped) return pick(mapped);
    if (isAuthenticationError(error)) return pick("errors.unauthorized");
    if (isOnboardingIncompleteError(error)) return pick("errors.onboardingIncompleteBody");
    if (isSubscriptionRequiredError(error)) return pick("errors.subscriptionRequiredBody");
    return fallback;
  }

  const normalized = normalizeApiError(error);

  if (normalized.isNetworkError) {
    return pick("errors.offline");
  }
  if (normalized.isTimeout) {
    return pick("errors.timeout");
  }

  const code = (normalized.code ?? "").trim().toUpperCase();
  if (code && CODE_TO_I18N[code]) {
    return pick(CODE_TO_I18N[code]);
  }
  if (code === EMAIL_NOT_VERIFIED) {
    return pick("auth.emailNotVerifiedError");
  }

  if (isAuthenticationError(error)) {
    return pick("errors.unauthorized");
  }
  if (isOnboardingIncompleteError(error)) {
    return pick("errors.onboardingIncompleteBody");
  }
  if (isSubscriptionRequiredError(error)) {
    if (code === "PLAN_LIMIT_EXCEEDED") return pick("errors.planLimitExceeded");
    return pick("errors.subscriptionRequiredBody");
  }

  if (normalized.status === 404) return pick("errors.notFound");
  if (normalized.status === 408 || normalized.status === 504) return pick("errors.timeout");
  if (normalized.status === 429) return pick("errors.rateLimited");
  if (normalized.status === 503) return pick("errors.unavailable");
  if (normalized.status != null && normalized.status >= 500) return pick("errors.server");
  if (normalized.status === 403) return pick("errors.forbidden");
  if (normalized.status === 400) {
    const fromMessage = resolveMessageKey(normalized.message ?? "");
    if (fromMessage) return pick(fromMessage);
    return pick("errors.validation");
  }

  const raw = normalized.message?.trim() ?? "";
  const fromMessage = resolveMessageKey(raw);
  if (fromMessage) return pick(fromMessage);

  // Do not pass through unmapped server English (breaks DE + leaks jargon).
  return fallback;
}
