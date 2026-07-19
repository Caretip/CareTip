import type { AuthStatus } from "./authSession";
import { isIntentionalUserLogout } from "./authTransitionIntent";
import { hasClientSessionHint } from "./authSessionHint";
import { hasClientStoredSession } from "./authUserStore";

/**
 * Single gate for public login surfaces — wait until session bootstrap finishes
 * before rendering login forms, session-resume cards, or marketing auth chrome.
 */
export function isAuthBootstrapComplete(authStatus: AuthStatus): boolean {
  return authStatus !== "initializing";
}

/** True when startup must validate storage/cookies before painting a login form. */
export function requiresAuthBootstrapBeforeLoginPaint(): boolean {
  return hasClientStoredSession() || hasClientSessionHint();
}

/**
 * Full-page neutral shell only for cold session bootstrap on auth surfaces.
 *
 * Post-login / Sign In handoffs keep the login form (or handoff cover) with button spinner —
 * never swap to this CareTip shell.
 */
export function shouldShowAuthBootstrapShell(options: {
  authStatus: AuthStatus;
  authTransitionPending: boolean;
  /** Cold anonymous visits may paint the form while bootstrap settles in the background. */
  allowImmediateLoginPaint?: boolean;
}): boolean {
  // Keep the form + button spinner during post-auth navigation preparation / handoff.
  if (options.authTransitionPending) return false;
  if (isIntentionalUserLogout()) return false;
  // Dynamic import avoided — handoff flag lives on document for sync checks during SSR-less SPA.
  if (typeof document !== "undefined" && document.documentElement.dataset.authSignInHandoff === "1") {
    return false;
  }
  if (
    options.authStatus === "initializing" &&
    options.allowImmediateLoginPaint &&
    !requiresAuthBootstrapBeforeLoginPaint()
  ) {
    return false;
  }
  if (options.authStatus === "initializing") return true;
  return false;
}
