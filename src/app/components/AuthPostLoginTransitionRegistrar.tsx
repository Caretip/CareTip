import { useEffect, useLayoutEffect, type ReactNode } from "react";
import { useLocation } from "react-router";
import { useSyncExternalStore } from "react";
import {
  endAuthPostLoginTransition,
  getAuthPostLoginTargetPath,
  getPostLoginTransitionMaxMs,
  isAuthPostLoginTransitionActive,
  signalPostLoginDashboardShellReady,
  subscribeAuthPostLoginTransition,
} from "../lib/authPostLoginTransition";

/** Dashboard layouts call {@link signalPostLoginDashboardShellReady} — not pathname alone. */
const DASHBOARD_SHELL_POST_LOGIN_PATHS = new Set([
  "/employee/dashboard",
  "/dashboard",
  "/platform-admin/dashboard",
]);

/**
 * Owns post-login soft-nav handoff without a branded CareTip overlay.
 * Destination dashboard shell + local skeletons take over after prefetched paint.
 */
export function AuthPostLoginTransitionRegistrar({ children }: { children: ReactNode }) {
  const active = useSyncExternalStore(
    subscribeAuthPostLoginTransition,
    isAuthPostLoginTransitionActive,
    () => false,
  );
  const { pathname } = useLocation();
  const targetPath = getAuthPostLoginTargetPath();

  /** Fallback for post-auth pages without a dashboard layout (onboarding, verify-email). */
  useLayoutEffect(() => {
    if (!active || !targetPath) return;
    const path = pathname.split("?")[0]?.split("#")[0] ?? pathname;
    if (path !== targetPath) return;
    if (DASHBOARD_SHELL_POST_LOGIN_PATHS.has(path)) return;

    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (!cancelled) signalPostLoginDashboardShellReady();
      });
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [active, pathname, targetPath]);

  useEffect(() => {
    if (!active) return;
    const id = window.setTimeout(() => {
      if (isAuthPostLoginTransitionActive()) {
        endAuthPostLoginTransition();
      }
    }, getPostLoginTransitionMaxMs());
    return () => window.clearTimeout(id);
  }, [active]);

  return <>{children}</>;
}
