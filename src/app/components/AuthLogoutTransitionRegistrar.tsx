import { useEffect, type ReactNode } from "react";
import { useSyncExternalStore } from "react";
import {
  endAuthLogoutTransition,
  getLogoutTransitionMaxMs,
  isAuthLogoutTransitionActive,
  subscribeAuthLogoutTransition,
} from "../lib/authLogoutTransition";

/**
 * Owns logout transition lifecycle (max-timeout safety).
 * Visual cover is {@link AuthLogoutHandoffCover} — this registrar must not leave the viewport empty.
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
