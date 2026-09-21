/**
 * Helpers for session restoration UX — avoid redirecting before bootstrap finishes.
 */

import type { AuthStatus } from "./authSession";
import { hasClientAccessToken, isClientSessionRevoked } from "./api";
import { getAuthSessionFlags } from "./authSessionBootstrap";
import { hasClientStoredSession } from "./authUserStore";

/** True while refresh/bootstrap has not finished validating the session. */
export function isAuthRestorePending(): boolean {
  if (isClientSessionRevoked()) return false;
  const { authHydrated, sessionValidated } = getAuthSessionFlags();
  return !authHydrated || !sessionValidated;
}

/** True after bootstrap/refresh has settled — safe for protected `/api/*` calls. */
export function isProtectedApiReady(): boolean {
  if (isClientSessionRevoked()) return false;
  const { authHydrated, sessionValidated } = getAuthSessionFlags();
  return authHydrated && sessionValidated;
}

/** Gate hooks (notifications, sockets) until JWT restoration has finished. */
export function isAuthenticatedAndApiReady(
  user: unknown,
  authStatus: AuthStatus,
): boolean {
  return authStatus === "authenticated" && Boolean(user) && isProtectedApiReady();
}

/** Protected fetch hooks — requires bootstrap settled and an in-memory access JWT. */
export function isAuthenticatedWithAccessToken(
  user: unknown,
  authStatus: AuthStatus,
): boolean {
  return isAuthenticatedAndApiReady(user, authStatus) && hasClientAccessToken();
}

/** Storage still has credentials but in-memory user is empty (post-validate race). */
export function hasPendingStoredSessionWithoutUser(user: unknown): boolean {
  if (isClientSessionRevoked()) return false;
  if (user) return false;
  return hasClientStoredSession();
}
