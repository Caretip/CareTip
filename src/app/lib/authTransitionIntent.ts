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

export { subscribeAuthLogoutTransition, isAuthLogoutTransitionActive };
export { subscribeAuthPostLoginTransition, isAuthPostLoginTransitionActive };

/** User clicked sign out — not cold-start session restore. */
export function isIntentionalUserLogout(): boolean {
  return (
    isAuthLogoutTransitionActive() ||
    isLogoutPending() ||
    isPostLogoutBootstrapSuppress()
  );
}

/** Block session bootstrap overlay while logout or post-login transition owns the global overlay. */
export function shouldSuppressSessionBootstrapOverlay(): boolean {
  return isIntentionalUserLogout() || isAuthPostLoginTransitionActive();
}

/** Sidebar sign-out button — brief disabled state, no global overlay. */
export function isUserSigningOut(): boolean {
  return isAuthLogoutTransitionActive() || isLogoutPending();
}
