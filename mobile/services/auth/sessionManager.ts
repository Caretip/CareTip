import { authService } from "@/services/auth/authService";
import { getAccessToken, getUserSnapshot } from "@/services/auth/tokenStorage";
import { hydrateAccessTokenFromSecureStore } from "@/services/api/client";
import { useAuthStore } from "@/store/authStore";
import { useUserStore } from "@/store/userStore";
import { useBusinessStore } from "@/store/businessStore";
import { useEmployeeStore } from "@/store/employeeStore";
import { queryClient } from "@/services/api/queryClient";
import { unregisterPushToken } from "@/services/api/settingsService";
import { getRegisteredPushToken, setRegisteredPushToken } from "@/utils/pushTokenRegistry";
import { clearAllOfflineQrCaches } from "@/utils/offlineQrCache";
import { logAuthEvent } from "@/utils/authDebug";

/**
 * Session manager — cold-start bootstrap + sign-out.
 * Mirrors web refresh bootstrap without duplicating backend rules.
 */

let bootstrapPromise: Promise<void> | null = null;

export async function bootstrapSession(): Promise<void> {
  if (bootstrapPromise) return bootstrapPromise;

  bootstrapPromise = (async () => {
    const auth = useAuthStore.getState();
    auth.setStatus("bootstrapping");
    logAuthEvent("bootstrap.start");

    try {
      await hydrateAccessTokenFromSecureStore();
      const access = await getAccessToken();
      const cachedUser = await getUserSnapshot();

      if (!access && !cachedUser) {
        useUserStore.getState().clear();
        auth.setUnauthenticated();
        logAuthEvent("bootstrap.unauthenticated", { reason: "no-local-secrets" });
        return;
      }

      if (cachedUser) {
        useUserStore.getState().setUser(cachedUser);
      }

      const refreshed = await authService.refreshSession();
      if (refreshed) {
        useUserStore.getState().setUser(refreshed.user);
        auth.setAuthenticated(refreshed.token);
        logAuthEvent("bootstrap.authenticated", { via: "refresh" });
        return;
      }

      if (access && cachedUser) {
        auth.setAuthenticated(access);
        logAuthEvent("bootstrap.authenticated", { via: "cached-access-token" });
        return;
      }

      useUserStore.getState().clear();
      auth.setUnauthenticated();
      logAuthEvent("bootstrap.unauthenticated", { reason: "refresh-failed" });
    } catch {
      useUserStore.getState().clear();
      auth.setStatus("error");
      auth.setUnauthenticated();
      logAuthEvent("bootstrap.error");
    }
  })();

  try {
    await bootstrapPromise;
  } finally {
    bootstrapPromise = null;
  }
}

export async function signOut(): Promise<void> {
  const pushToken = getRegisteredPushToken();
  if (pushToken) {
    try {
      await unregisterPushToken(pushToken);
    } catch {
      /* Non-fatal — local session must still clear. */
    }
    setRegisteredPushToken(null);
  }

  await authService.logout();
  try {
    await clearAllOfflineQrCaches();
  } catch {
    /* Non-fatal — session secrets already cleared. */
  }
  useUserStore.getState().clear();
  useBusinessStore.getState().clear();
  useEmployeeStore.getState().clear();
  useAuthStore.getState().setUnauthenticated();
  queryClient.clear();
}

export const sessionManager = {
  bootstrapSession,
  signOut,
};
