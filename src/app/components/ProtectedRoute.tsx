import type { ReactNode } from "react";
import { useEffect, useSyncExternalStore } from "react";
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
    return null;
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
      return <Navigate to={gate.decision.to} replace state={{ from: gate.pathname }} />;
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
    return <Navigate to={gate.loginPath} replace state={{ from: gate.pathname }} />;
  }

  if (gate.decision?.kind === "redirect") {
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
    return <Navigate to={gate.decision.to} replace state={{ from: gate.pathname }} />;
  }

  authDebug("route_guard", { decision: "allow", path: gate.pathname });
  navFlashLog("guard_resolved", { path: gate.pathname, guard: "ProtectedRoute", decision: "allow" });
  return <>{children}</>;
}
