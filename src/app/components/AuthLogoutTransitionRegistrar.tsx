import { useEffect, type ReactNode } from "react";
import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import {
  APP_LOADING_PRIORITY,
  useAppLoadingRegistration,
} from "../context/AppLoadingManager";
import {
  endAuthLogoutTransition,
  getLogoutTransitionMaxMs,
  isAuthLogoutTransitionActive,
  subscribeAuthLogoutTransition,
} from "../lib/authLogoutTransition";
import { resolveAppLoadingContextMessage } from "../lib/appLoadingContexts";

/**
 * Global branded overlay for intentional sign-out — survives layout unmount.
 * Stays until AuthPage / platform login signals ready (or max timeout).
 */
export function AuthLogoutTransitionRegistrar({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const active = useSyncExternalStore(
    subscribeAuthLogoutTransition,
    isAuthLogoutTransitionActive,
    () => false,
  );

  useAppLoadingRegistration(
    "auth-logout-transition",
    APP_LOADING_PRIORITY.AUTH,
    active,
    resolveAppLoadingContextMessage("signingOut", t),
  );

  useEffect(() => {
    if (!active) return;
    const id = window.setTimeout(() => {
      if (isAuthLogoutTransitionActive()) {
        endAuthLogoutTransition();
      }
    }, getLogoutTransitionMaxMs());
    return () => window.clearTimeout(id);
  }, [active]);

  return <>{children}</>;
}
