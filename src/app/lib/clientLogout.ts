/**
 * Synchronous client-side logout cleanup — runs under the logout overlay before navigate.
 * Server refresh invalidation runs separately via {@link logoutAPIWithTimeout}.
 */

import {
  cancelPendingSessionRefresh,
  clearClientAuthStorage,
  markClientSessionRevoked,
} from "./api";
import { getMemoryAccessToken } from "./accessTokenStore";
import { authDebug } from "./authDebugLog";
import { deriveAuthSession, getLoginPathForSessionRole } from "./authSession";
import { bumpSessionEpoch } from "./authSessionEpoch";
import { markSessionBootstrapSettled } from "./authSessionBootstrap";
import { notifyAuthStorageSync } from "./authStorageSync";
import { clearImpersonationAdminBackup } from "./impersonationSessionBackup";
import { clearEmployeeNotifications } from "./employeeNotificationStore";
import { resetAllClientSessionCaches } from "./resetAllClientSessionCaches";
import { commitAuthUser, getAuthUser } from "./authUserStore";

export type LogoutSnapshot = {
  loginPath: string;
  capturedAccessToken: string | null;
};

export type ClientLogoutResult = LogoutSnapshot & {
  clientCleanupMs: number;
};

/** Capture routing + token before session teardown (call before navigate). */
export function captureLogoutSnapshot(): LogoutSnapshot {
  const priorUser = getAuthUser();
  return {
    loginPath: priorUser ? getLoginPathForSessionRole(priorUser.role) : "/login",
    capturedAccessToken: getMemoryAccessToken(),
  };
}

/** Clears all local session state; returns token snapshot for background logout POST. */
export function performClientLogoutCleanup(
  snapshot: LogoutSnapshot = captureLogoutSnapshot(),
): ClientLogoutResult {
  const started = performance.now();
  const priorUser = getAuthUser();

  bumpSessionEpoch();
  clearEmployeeNotifications();
  clearImpersonationAdminBackup();
  markClientSessionRevoked();
  cancelPendingSessionRefresh();
  commitAuthUser(null);
  resetAllClientSessionCaches();
  clearClientAuthStorage({ notifySync: false });
  markSessionBootstrapSettled();
  notifyAuthStorageSync();

  const clientCleanupMs = performance.now() - started;
  authDebug("logout_client_cleanup", {
    loginPath: snapshot.loginPath,
    clientCleanupMs: Math.round(clientCleanupMs),
    priorRole: priorUser?.role ?? null,
    session: deriveAuthSession(null),
  });

  return { ...snapshot, clientCleanupMs };
}
