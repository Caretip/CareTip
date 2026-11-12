import type { ReactNode } from "react";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Navigate } from "react-router";
import { isClientSessionRevoked } from "../lib/api";
import { authDebug } from "../lib/authDebugLog";
import { navFlashLog } from "../lib/navigationFlashAudit";
import {
  APP_LOADING_PRIORITY,
  useAppLoadingRegistration,
} from "../context/AppLoadingManager";
import { useProtectedRouteGate } from "../hooks/useProtectedRouteGate";
import {
  isAuthLogoutTransitionActive,
  isAuthPostLoginTransitionActive,
  isAuthSignInHandoffActive,
  subscribeAuthLogoutTransition,
  subscribeAuthPostLoginTransition,
  subscribeAuthSignInHandoff,
} from "../lib/authTransitionIntent";
import { AppRouteGateShell } from "./AppRouteGateShell";
import { resolveRouteLoadingMessage } from "../lib/appLoadingContexts";
import { shouldRegisterBrandedRouteGuard } from "../lib/appLoadingJourney";
import { markPostLoginTrace } from "../lib/postLoginRuntimeTrace";

/**
 * True when a redirect would point at the page we are already on. While a lazy route swaps in, this
 * (old) guard can still be mounted with the new location; navigating again on every render looped
 * ("Maximum update depth exceeded") until the next route's chunk resolved.
 */
function isRedirectToCurrentPath(to: string, pathname: string): boolean {
  const target = to.split(/[?#]/)[0]?.replace(/\/+$/, "") || "/";
  const current = pathname.replace(/\/+$/, "") || "/";
  return target === current;
}

export function ProtectedRoute({
  allowedRoles,
  children,
}: {
  allowedRoles: Array<"business" | "employee">;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const gate = useProtectedRouteGate(allowedRoles);
  const rolesKey = allowedRoles.join(",");
  // <Navigate> re-navigates whenever `state` changes identity; a fresh object per render made every
  // re-render during a pending (lazy) route transition navigate again → "Maximum update depth exceeded".
  const navigateState = useMemo(() => ({ from: gate.pathname }), [gate.pathname]);
  const logoutTransitionActive = useSyncExternalStore(
    subscribeAuthLogoutTransition,
    isAuthLogoutTransitionActive,
    () => false,
  );
  const postLoginTransitionActive = useSyncExternalStore(
    subscribeAuthPostLoginTransition,
    isAuthPostLoginTransitionActive,
    () => false,
  );
  const signInHandoffActive = useSyncExternalStore(
    subscribeAuthSignInHandoff,
    isAuthSignInHandoffActive,
    () => false,
  );

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    markPostLoginTrace("ProtectedRoute_render", {
      pathname: gate.pathname,
      signInHandoffActive,
      blocking: gate.blocking,
      hasUser: Boolean(gate.user),
      decision: gate.decision?.kind ?? null,
    });
  }, [
    gate.pathname,
    gate.blocking,
    gate.user,
    gate.decision?.kind,
    signInHandoffActive,
  ]);

  useAppLoadingRegistration(
    `protected-route-guard:${rolesKey}:${gate.pathname}`,
    APP_LOADING_PRIORITY.ROUTE_GUARD,
    gate.guardBlocking &&
      !logoutTransitionActive &&
      !postLoginTransitionActive &&
      !signInHandoffActive &&
      shouldRegisterBrandedRouteGuard(gate),
    resolveRouteLoadingMessage(gate.pathname, t),
  );

  if (logoutTransitionActive) {
    // Keep the current tree until the login route commits. Returning null unmounted the
    // entire employee/business shell synchronously under AuthLogoutHandoffCover, which
    // delayed AuthPage and left "Signing you out…" on screen. The cover is z-10000.
    return <>{children}</>;
  }

  /**
   * Sign In handoff cover owns the viewport. Never paint AppRouteGateShell (blank white).
   * Mount children as soon as the gate can allow so Dashboard can paint under the cover.
   */
  if (signInHandoffActive) {
    if (gate.blocking || !gate.user) {
      if (import.meta.env.DEV) {
        markPostLoginTrace("ProtectedRoute_handoff_null", {
          blocking: gate.blocking,
          hasUser: Boolean(gate.user),
          authBlocking: gate.authBlocking,
          storedSessionSync: gate.storedSessionSync,
          guardBlocking: gate.guardBlocking,
        });
      }
      return null;
    }
    if (gate.decision?.kind === "redirect") {
      if (isRedirectToCurrentPath(gate.decision.to, gate.pathname)) return null;
      return <Navigate to={gate.decision.to} replace state={navigateState} />;
    }
    return <>{children}</>;
  }

  if (gate.blocking) {
    if (gate.guardBlocking) {
      authDebug("route_guard", {
        decision: "loading",
        reason: gate.decision?.kind === "wait" ? gate.decision.reason : "pending",
        path: gate.pathname,
      });
      navFlashLog("guard_started", {
        path: gate.pathname,
        guard: "ProtectedRoute",
        reason: gate.decision?.kind === "wait" ? gate.decision.reason : "auth_pending",
      });
    }
    return <AppRouteGateShell />;
  }

  if (!gate.user) {
    if (!isClientSessionRevoked() && gate.storedSessionSync) {
      navFlashLog("guard_started", {
        path: gate.pathname,
        guard: "ProtectedRoute",
        reason: "stored_session_sync",
      });
      return <AppRouteGateShell />;
    }
    authDebug("route_guard", {
      decision: "redirect",
      to: gate.loginPath,
      reason: "not_authenticated",
      path: gate.pathname,
    });
    navFlashLog("redirect_scheduled", {
      path: gate.pathname,
      to: gate.loginPath,
      guard: "ProtectedRoute",
      reason: "not_authenticated",
    });
    return <Navigate to={gate.loginPath} replace state={navigateState} />;
  }

  if (gate.decision?.kind === "redirect") {
    if (isRedirectToCurrentPath(gate.decision.to, gate.pathname)) {
      // Already on the target; the matching route is mounting — do not navigate again.
      return <AppRouteGateShell />;
    }
    authDebug("route_guard", {
      decision: "redirect",
      to: gate.decision.to,
      reason: gate.decision.reason,
      path: gate.pathname,
    });
    navFlashLog("redirect_scheduled", {
      path: gate.pathname,
      to: gate.decision.to,
      guard: "ProtectedRoute",
      reason: gate.decision.reason,
    });
    return <Navigate to={gate.decision.to} replace state={navigateState} />;
  }

  authDebug("route_guard", { decision: "allow", path: gate.pathname });
  navFlashLog("guard_resolved", { path: gate.pathname, guard: "ProtectedRoute", decision: "allow" });
  return <>{children}</>;
}
