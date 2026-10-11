import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useLocation } from "react-router";
import { useAuth } from "../hooks/useAuth";
import { isAuthRestorePending } from "../lib/authRestore";
import { hasClientStoredSession } from "../lib/authUserStore";
import { isClientSessionRevoked } from "../lib/api";
import { canAccessPlatformAdminWorkspace } from "../lib/authSession";
import {
  isAuthLogoutTransitionActive,
  subscribeAuthLogoutTransition,
} from "../lib/authLogoutTransition";
import {
  APP_LOADING_PRIORITY,
  useAppLoadingRegistration,
} from "../context/AppLoadingManager";
import { resolveAppLoadingContextMessage } from "../lib/appLoadingContexts";
import { AppRouteGateShell } from "./AppRouteGateShell";
import { navFlashLog } from "../lib/navigationFlashAudit";

interface PlatformAdminRouteProps {
  children: ReactNode;
}

/** Requires an authenticated platform admin (SuperAdmin). */
export function PlatformAdminRoute({ children }: PlatformAdminRouteProps) {
  const { t } = useTranslation();
  const { user, authStatus } = useAuth();
  const location = useLocation();

  const authBlocking = authStatus === "initializing" || isAuthRestorePending();
  const storedSessionSync =
    !user && !isClientSessionRevoked() && hasClientStoredSession();
  const blocking = authBlocking || storedSessionSync;
  const logoutTransitionActive = useSyncExternalStore(
    subscribeAuthLogoutTransition,
    isAuthLogoutTransitionActive,
    () => false,
  );

  useAppLoadingRegistration(
    `platform-admin-route-guard:${location.pathname}`,
    APP_LOADING_PRIORITY.ROUTE_GUARD,
    blocking && !logoutTransitionActive,
    resolveAppLoadingContextMessage("sessionCheck", t),
  );

  if (logoutTransitionActive) {
    return null;
  }

  if (blocking) {
    navFlashLog("guard_started", {
      path: location.pathname,
      guard: "PlatformAdminRoute",
      reason: authBlocking ? "auth_pending" : "stored_session_sync",
    });
    return <AppRouteGateShell />;
  }

  if (!user) {
    navFlashLog("redirect_scheduled", {
      path: location.pathname,
      to: "/platform-admin/login",
      guard: "PlatformAdminRoute",
      reason: "not_authenticated",
    });
    return <Navigate to="/platform-admin/login" replace state={{ from: location.pathname }} />;
  }

  if (!canAccessPlatformAdminWorkspace(user)) {
    navFlashLog("redirect_scheduled", {
      path: location.pathname,
      to: "/unauthorized",
      guard: "PlatformAdminRoute",
      reason: "wrong_role",
    });
    return <Navigate to="/unauthorized" replace />;
  }

  navFlashLog("guard_resolved", { path: location.pathname, guard: "PlatformAdminRoute", decision: "allow" });
  return <>{children}</>;
}
