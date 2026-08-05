import { normalizeApiError } from "@/types/api";

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

const TECHNICAL_PATTERNS = [
  /request failed with status code/i,
  /network error/i,
  /axioserror/i,
  /err_network/i,
  /econnrefused/i,
  /enotfound/i,
  /timeout/i,
  /could not reach the caretip api/i,
];

const ALLOWED_SERVER_MESSAGES = new Set([
  "Insufficient permissions",
  "Authentication required",
  "Account pending verification",
  "Email verification required",
  "Business context required",
  "Employee not found",
  "Branded QR not found",
]);

function isTechnicalMessage(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return true;
  if (/^\d{3}$/.test(trimmed)) return true;
  if (TECHNICAL_PATTERNS.some((re) => re.test(trimmed))) return true;
  if (trimmed.includes(" at ") && trimmed.includes(".ts")) return true;
  return false;
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
  if (normalized.code === "AUTH_REQUIRED") return true;
  return /authentication required/i.test(normalized.message || "");
}

export function isPermissionError(error: unknown): boolean {
  if (!error) return false;
  // Keep plan / onboarding / auth failures out of the role-permission EmptyState.
  if (isSubscriptionRequiredError(error)) return false;
  if (isOnboardingIncompleteError(error)) return false;
  if (isAuthenticationError(error)) return false;
  if (typeof error === "string") {
    return error === "Insufficient permissions" || /403|forbidden|permission/i.test(error);
  }
  const normalized = normalizeApiError(error);
  if (normalized.status === 403) return true;
  const raw = normalized.message || "";
  return raw === "Insufficient permissions" || /forbidden|permission/i.test(raw);
}

/**
 * Global user-facing error formatter — never surfaces Axios/stack/raw HTTP text.
 * Order: network → auth → onboarding → subscription → status → allowlist → raw.
 */
export function formatUserFacingError(
  error: unknown,
  fallback: string,
  t?: TranslateFn,
): string {
  const pick = (key: string) => (t ? t(key) : fallback);

  if (!error) return fallback;
  if (typeof error === "string") {
    if (isAuthenticationError(error)) return pick("errors.unauthorized");
    if (isOnboardingIncompleteError(error)) return pick("errors.onboardingIncompleteBody");
    if (isSubscriptionRequiredError(error)) return pick("errors.subscriptionRequiredBody");
    if (ALLOWED_SERVER_MESSAGES.has(error)) {
      return pick(
        error === "Insufficient permissions"
          ? "errors.forbidden"
          : error === "Authentication required"
            ? "errors.unauthorized"
            : "errors.generic",
      );
    }
    return isTechnicalMessage(error) ? fallback : error;
  }

  const normalized = normalizeApiError(error);

  if (normalized.isNetworkError) {
    return pick("errors.offline");
  }
  if (normalized.isTimeout) {
    return pick("errors.timeout");
  }

  if (isAuthenticationError(error)) {
    return pick("errors.unauthorized");
  }
  if (isOnboardingIncompleteError(error)) {
    return pick("errors.onboardingIncompleteBody");
  }
  if (isSubscriptionRequiredError(error)) {
    return pick("errors.subscriptionRequiredBody");
  }

  if (normalized.status === 404) return pick("errors.notFound");
  if (normalized.status === 408 || normalized.status === 504) return pick("errors.timeout");
  if (normalized.status === 503) return pick("errors.unavailable");
  if (normalized.status != null && normalized.status >= 500) return pick("errors.server");
  if (normalized.status === 403) return pick("errors.forbidden");

  const raw = normalized.message?.trim() ?? "";
  if (raw && ALLOWED_SERVER_MESSAGES.has(raw)) {
    return pick(
      raw === "Insufficient permissions" ? "errors.forbidden" : "errors.generic",
    );
  }

  if (raw && !isTechnicalMessage(raw)) {
    return raw;
  }

  return fallback;
}
