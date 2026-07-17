import { useEffect, type ReactNode } from "react";
import { useSyncExternalStore } from "react";
import {
  endAuthLogoutTransition,
  getLogoutTransitionMaxMs,
  isAuthLogoutTransitionActive,
  subscribeAuthLogoutTransition,
} from "../lib/authLogoutTransition";

/**
 * Owns logout transition lifecycle without a branded loading screen.
 * Logout redirects immediately; destination login renders naturally.
 */
export function AuthLogoutTransitionRegistrar({ children }: { children: ReactNode }) {
  const active = useSyncExternalStore(
    subscribeAuthLogoutTransition,
    isAuthLogoutTransitionActive,
    () => false,
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
