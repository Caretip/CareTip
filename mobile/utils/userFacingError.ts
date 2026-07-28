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

function statusKey(status: number | null): string | null {
  if (status === 401) return "errors.unauthorized";
  if (status === 403) return "errors.forbidden";
  if (status === 404) return "errors.notFound";
  if (status === 408 || status === 504) return "errors.timeout";
  if (status === 503) return "errors.unavailable";
  if (status != null && status >= 500) return "errors.server";
  return null;
}

/**
 * Global user-facing error formatter — never surfaces Axios/stack/raw HTTP text.
 */
export function formatUserFacingError(
  error: unknown,
  fallback: string,
  t?: TranslateFn,
): string {
  const pick = (key: string) => (t ? t(key) : fallback);

  if (!error) return fallback;
  if (typeof error === "string") {
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

  const byStatus = statusKey(normalized.status);
  if (byStatus) return pick(byStatus);

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

export function isPermissionError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === "string") {
    return error === "Insufficient permissions" || /403|forbidden|permission/i.test(error);
  }
  const normalized = normalizeApiError(error);
  if (normalized.status === 403) return true;
  const raw = normalized.message || "";
  return raw === "Insufficient permissions" || /forbidden|permission/i.test(raw);
}
