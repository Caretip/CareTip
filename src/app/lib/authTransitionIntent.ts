/**
 * Single source of truth for auth transition intent.
 * Distinguishes session bootstrap from intentional logout so loaders never compete.
 */

import { isLogoutPending } from "./api";
import {
  isAuthLogoutTransitionActive,
  isPostLogoutBootstrapSuppress,
  subscribeAuthLogoutTransition,
} from "./authLogoutTransition";
import {
  isAuthPostLoginTransitionActive,
  subscribeAuthPostLoginTransition,
} from "./authPostLoginTransition";
import {
  isAuthSignInHandoffActive,
  subscribeAuthSignInHandoff,
} from "./authSignInHandoff";

export { subscribeAuthLogoutTransition, isAuthLogoutTransitionActive };
export { subscribeAuthPostLoginTransition, isAuthPostLoginTransitionActive };
export { subscribeAuthSignInHandoff, isAuthSignInHandoffActive };

/** User clicked sign out — not cold-start session restore. */
export function isIntentionalUserLogout(): boolean {
  return (
    isAuthLogoutTransitionActive() ||
    isLogoutPending() ||
    isPostLogoutBootstrapSuppress()
  );
}

/**
 * Block session bootstrap / branded re-entry while logout, post-login, or Sign In handoff owns UX.
 */
export function shouldSuppressSessionBootstrapOverlay(): boolean {
  return (
    isIntentionalUserLogout() ||
    isAuthPostLoginTransitionActive() ||
    isAuthSignInHandoffActive()
  );
}

/** Sidebar sign-out button — brief disabled state, no global overlay. */
export function isUserSigningOut(): boolean {
  return isAuthLogoutTransitionActive() || isLogoutPending();
}
