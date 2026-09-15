import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Navigate } from "react-router";
import { isClientSessionRevoked } from "../lib/api";
import { authDebug } from "../lib/authDebugLog";
import {
  APP_LOADING_PRIORITY,
  useAppLoadingRegistration,
} from "../context/AppLoadingManager";
import { useProtectedRouteGate } from "../hooks/useProtectedRouteGate";
import {
  isAuthLogoutTransitionActive,
  isAuthPostLoginTransitionActive,
  subscribeAuthLogoutTransition,
  subscribeAuthPostLoginTransition,
} from "../lib/authTransitionIntent";
import { AppRouteGateShell } from "./AppRouteGateShell";
import { resolveRouteLoadingMessage } from "../lib/appLoadingContexts";
import { shouldRegisterBrandedRouteGuard } from "../lib/appLoadingJourney";

interface RoleProtectedRouteProps {
  allowedRoles: Array<"business" | "employee">;
  children: ReactNode;
}

/**
 * Same guard as {@link ProtectedRoute} (single resolver). Waits on `authHydrated` so guards
 * do not redirect before the initial session refresh (or no-token path) completes.
 */
export function RoleProtectedRoute({ allowedRoles, children }: RoleProtectedRouteProps) {
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

  useAppLoadingRegistration(
    `role-protected-route-guard:${rolesKey}:${gate.pathname}`,
    APP_LOADING_PRIORITY.ROUTE_GUARD,
    gate.guardBlocking &&
      !logoutTransitionActive &&
      !postLoginTransitionActive &&
      shouldRegisterBrandedRouteGuard(gate),
    resolveRouteLoadingMessage(gate.pathname, t),
  );

  if (logoutTransitionActive) {
    // Same as ProtectedRoute: do not synchronously unmount the shell under the logout cover.
    return <>{children}</>;
  }

  if (gate.blocking) {
    if (gate.guardBlocking) {
      authDebug("route_guard", {
        decision: "loading",
        reason: gate.decision?.kind === "wait" ? gate.decision.reason : "pending",
        path: gate.pathname,
        scope: "RoleProtectedRoute",
      });
    }
    return <AppRouteGateShell />;
  }

  if (!gate.user) {
    if (!isClientSessionRevoked() && gate.storedSessionSync) {
      return <AppRouteGateShell />;
    }
    authDebug("route_guard", {
      decision: "redirect",
      to: gate.loginPath,
      reason: "not_authenticated",
      path: gate.pathname,
      scope: "RoleProtectedRoute",
    });
    return <Navigate to={gate.loginPath} replace state={{ from: gate.pathname }} />;
  }

  if (gate.decision?.kind === "redirect") {
    authDebug("route_guard", {
      decision: "redirect",
      to: gate.decision.to,
      reason: gate.decision.reason,
      path: gate.pathname,
      scope: "RoleProtectedRoute",
    });
    return <Navigate to={gate.decision.to} replace state={{ from: gate.pathname }} />;
  }

  authDebug("route_guard", { decision: "allow", path: gate.pathname, scope: "RoleProtectedRoute" });
  return <>{children}</>;
}
