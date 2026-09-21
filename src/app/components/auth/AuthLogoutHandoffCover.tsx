import { useSyncExternalStore } from "react";
import { useLocation } from "react-router";
import {
  getAuthLogoutTargetPath,
  isAuthLogoutTransitionActive,
  isLogoutHandoffDestinationReady,
  subscribeAuthLogoutTransition,
} from "../../lib/authLogoutTransition";
import { useSignalLogoutDestinationReady } from "../../lib/useSignalLogoutAuthPageReady";
import { AuthBootstrapShell } from "./AuthBootstrapShell";

/**
 * Logout visual owner: covers the SPA swap until the signed-out login route commits.
 * React Router `lazy` does not suspend Outlet — without this cover the viewport can be empty.
 */
export function AuthLogoutHandoffCover() {
  const { pathname } = useLocation();
  useSignalLogoutDestinationReady();
  const visible = useSyncExternalStore(
    subscribeAuthLogoutTransition,
    isAuthLogoutTransitionActive,
    () => false,
  );
  const target = useSyncExternalStore(
    subscribeAuthLogoutTransition,
    getAuthLogoutTargetPath,
    () => null,
  );

  if (!visible) return null;
  if (isLogoutHandoffDestinationReady(pathname, target)) return null;

  return (
    <div
      className="caretip-logout-handoff-cover fixed inset-0 z-[10000] overflow-hidden overscroll-none bg-background"
      data-testid="auth-logout-handoff-cover"
      aria-hidden
    >
      <AuthBootstrapShell className="h-full min-h-[100dvh]" calm showTagline={false} />
    </div>
  );
}
