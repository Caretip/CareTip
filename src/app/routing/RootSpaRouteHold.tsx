import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigation } from "react-router";
import { AuthBootstrapShell } from "../components/auth/AuthBootstrapShell";
import { isAuthLogoutTransitionActive, subscribeAuthLogoutTransition } from "../lib/authLogoutTransition";
import { isAuthSignInHandoffCoverVisible, subscribeAuthSignInHandoff } from "../lib/authSignInHandoff";
import { isInShellAuthenticatedNavigation } from "../lib/publicRoutes";
import { isAppShellInteractive } from "../lib/appShellLifecycle";

/**
 * React Router `lazy` does not suspend `<Outlet />`. Soft SPA navigations that replace
 * the root route tree therefore leave #root empty until the destination chunk resolves.
 *
 * Cold boot is already covered by HTML boot + branded overlay (`!isAppShellInteractive`).
 * Nested dashboard child routes keep their layout — skip this hold there.
 * Logout / Sign In already own z-10000 covers.
 */
export function RootSpaRouteHold() {
  const { t } = useTranslation();
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

  return (
    <div className="fixed inset-0 z-[9990]" data-testid="root-spa-route-hold">
      <AuthBootstrapShell className="h-full min-h-[100dvh]" tagline={t("common.gettingReady")} />
    </div>
  );
}
