/**
 * Root idle session controller — no-op unless feature flag + authenticated gate (§1.6).
 * Mounted once under the app router root so `useAuth().logout` works.
 */

import { useMemo, useSyncExternalStore } from "react";
import { useAuth } from "../hooks/useAuth";
import { useIdleSessionGuard } from "../hooks/useIdleSessionGuard";
import { IdleWarningModal } from "./IdleWarningModal";
import { isIdleSessionTimeoutEnabled } from "../lib/idleSessionConfig";
import {
  isAuthLogoutTransitionActive,
  subscribeAuthLogoutTransition,
} from "../lib/authLogoutTransition";

function useAuthLogoutTransitionActive(): boolean {
  return useSyncExternalStore(
    subscribeAuthLogoutTransition,
    isAuthLogoutTransitionActive,
    () => false,
  );
}

export function IdleSessionController() {
  const { user, authStatus, sessionValidated, logout } = useAuth();
  const logoutTransitionActive = useAuthLogoutTransitionActive();
  const flagEnabled = isIdleSessionTimeoutEnabled();

  const active = useMemo(() => {
    if (!flagEnabled) return false;
    if (authStatus !== "authenticated") return false;
    if (!sessionValidated) return false;
    if (!user) return false;
    if (logoutTransitionActive) return false;
    return true;
  }, [flagEnabled, authStatus, sessionValidated, user, logoutTransitionActive]);

  const { warning, staySignedIn, logOutNow } = useIdleSessionGuard(active, logout);

  if (!flagEnabled) {
    return null;
  }

  return (
    <IdleWarningModal
      open={warning.open}
      phase={warning.phase}
      secondsRemaining={warning.secondsRemaining}
      onStaySignedIn={staySignedIn}
      onLogOut={logOutNow}
    />
  );
}
