import { useSyncExternalStore } from "react";
import { useLocation, useNavigation } from "react-router";
import { isAuthLogoutTransitionActive, subscribeAuthLogoutTransition } from "../lib/authLogoutTransition";
import { isAuthSignInHandoffCoverVisible, subscribeAuthSignInHandoff } from "../lib/authSignInHandoff";
import { isInShellAuthenticatedNavigation, isInShellMarketingNavigation } from "../lib/publicRoutes";
import { isAppShellInteractive } from "../lib/appShellLifecycle";
import { SoftSpaRouteHold } from "./SoftSpaRouteHold";

/**
 * React Router `lazy` does not suspend `<Outlet />`. Soft SPA navigations that replace
 * the root route tree therefore leave #root empty until the destination chunk resolves.
 *
 * Cold boot is already covered by HTML boot + branded overlay (`!isAppShellInteractive`).
 * Nested dashboard child routes keep their layout — skip this hold there.
 * Logout / Sign In already own z-10000 covers.
 */
export function RootSpaRouteHold() {
  const navigation = useNavigation();
  const location = useLocation();
  const logoutActive = useSyncExternalStore(
    subscribeAuthLogoutTransition,
    isAuthLogoutTransitionActive,
    () => false,
  );
  const signInCover = useSyncExternalStore(
    subscribeAuthSignInHandoff,
    isAuthSignInHandoffCoverVisible,
    () => false,
  );

  if (logoutActive || signInCover) return null;
  if (!isAppShellInteractive()) return null;
  if (navigation.state !== "loading") return null;

  const nextPath = navigation.location?.pathname ?? location.pathname;
  if (isInShellAuthenticatedNavigation(location.pathname, nextPath)) return null;
  if (isInShellMarketingNavigation(location.pathname, nextPath)) return null;

  return <SoftSpaRouteHold testId="root-spa-route-hold" />;
}
