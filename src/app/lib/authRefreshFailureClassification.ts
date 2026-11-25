import { isApiRequestError, SESSION_REFRESH_REJECTED_CODE } from "./apiError";
import { SERVICE_UNAVAILABLE_CLIENT_MESSAGE } from "./errorMessages";

/** True when a refresh/bootstrap failure definitively invalidates the session (not transient infra). */
export function isDefinitiveRefreshFailure(err: unknown): boolean {
  // Display copy is not a contract: the rejection is identified by its code first.
  if (isApiRequestError(err) && err.code === SESSION_REFRESH_REJECTED_CODE) return true;
  const msg = err instanceof Error ? err.message : String(err ?? "");
  if (!msg) return false;
  if (msg === SERVICE_UNAVAILABLE_CLIENT_MESSAGE) return false;
  if (/servers hit a problem|try again in a few minutes|network|unavailable|timeout/i.test(msg)) {
    return false;
  }
  return /session has expired|sign in again|authentication required|invalid or expired/i.test(msg);
}
