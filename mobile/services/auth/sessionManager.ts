import { authService } from "@/services/auth/authService";
import { getAccessToken, getUserSnapshot } from "@/services/auth/tokenStorage";
import { hydrateAccessTokenFromSecureStore, getMemoryAccessToken } from "@/services/api/client";
import { useAuthStore } from "@/store/authStore";
import { useUserStore } from "@/store/userStore";
import { useBusinessStore } from "@/store/businessStore";
import { useEmployeeStore } from "@/store/employeeStore";
import { queryClient } from "@/services/api/queryClient";
import { unregisterPushToken } from "@/services/api/settingsService";
import { getRegisteredPushToken, setRegisteredPushToken } from "@/utils/pushTokenRegistry";
import { clearAllOfflineQrCaches } from "@/utils/offlineQrCache";
import { logAuthEvent } from "@/utils/authDebug";
import { STARTUP_TASK_TIMEOUT_MS } from "@/constants/startup";
import { withTimeout } from "@/utils/withTimeout";
import { useStartupStore } from "@/store/startupStore";

/**
 * Session manager — cold-start bootstrap + sign-out.
 * Every I/O path is bounded; never blocks the splash indefinitely.
 */

let bootstrapPromise: Promise<void> | null = null;

async function readLocalSession(): Promise<{
  access: string | null;
  cachedUser: Awaited<ReturnType<typeof getUserSnapshot>>;
}> {
  await withTimeout(
    hydrateAccessTokenFromSecureStore(),
    STARTUP_TASK_TIMEOUT_MS,
    "secureStore.hydrate",
  );
  const [access, cachedUser] = await Promise.all([
    withTimeout(getAccessToken(), STARTUP_TASK_TIMEOUT_MS, "secureStore.accessToken"),
    withTimeout(getUserSnapshot(), STARTUP_TASK_TIMEOUT_MS, "secureStore.userSnapshot"),
  ]);
  return { access, cachedUser };
}

async function tryRefreshSession(): Promise<Awaited<ReturnType<typeof authService.refreshSession>>> {
  return withTimeout(
    authService.refreshSession(),
    STARTUP_TASK_TIMEOUT_MS,
    "auth.refreshSession",
  );
}

async function runBootstrap(): Promise<void> {
  const auth = useAuthStore.getState();
  auth.setStatus("bootstrapping");
  logAuthEvent("bootstrap.start");

  try {
    const { access, cachedUser } = await readLocalSession();

    if (!access && !cachedUser) {
      useUserStore.getState().clear();
      auth.setUnauthenticated();
      logAuthEvent("bootstrap.unauthenticated", { reason: "no-local-secrets" });
      return;
    }

    if (cachedUser) {
      useUserStore.getState().setUser(cachedUser);
    }

    try {
      const refreshed = await tryRefreshSession();
      if (refreshed) {
        useUserStore.getState().setUser(refreshed.user);
        auth.setAuthenticated(refreshed.token);
        logAuthEvent("bootstrap.authenticated", { via: "refresh" });
        return;
      }
    } catch (error) {
      logAuthEvent("bootstrap.refresh.timeoutOrError", {
        message: error instanceof Error ? error.message : "unknown",
      });
    }

    if (access && cachedUser) {
      auth.setAuthenticated(access);
      logAuthEvent("bootstrap.authenticated", { via: "cached-access-token" });
      return;
    }

    useUserStore.getState().clear();
    auth.setUnauthenticated();
    logAuthEvent("bootstrap.unauthenticated", { reason: "refresh-failed" });
  } catch (error) {
    logAuthEvent("bootstrap.error", {
      message: error instanceof Error ? error.message : "unknown",
    });
    useUserStore.getState().clear();
    auth.setUnauthenticated();
  }
}

export async function bootstrapSession(): Promise<void> {
  if (bootstrapPromise) return bootstrapPromise;

  const startup = useStartupStore.getState();

  bootstrapPromise = (async () => {
    try {
      await withTimeout(runBootstrap(), STARTUP_TASK_TIMEOUT_MS, "bootstrap.total", () => {
        startup.markBootstrapTimedOut();
        const auth = useAuthStore.getState();
        if (auth.status === "bootstrapping" || auth.status === "idle" || !auth.isHydrated) {
          const token = getMemoryAccessToken();
          if (token) {
            auth.setAuthenticated(token);
            logAuthEvent("bootstrap.authenticated", { via: "timeout-cached-token" });
          } else {
            useUserStore.getState().clear();
            auth.setUnauthenticated();
            logAuthEvent("bootstrap.unauthenticated", { reason: "timeout" });
          }
        }
      });
    } catch {
      if (!useAuthStore.getState().isHydrated) {
        useUserStore.getState().clear();
        useAuthStore.getState().setUnauthenticated();
      }
    } finally {
      startup.markBootstrapSettled("bootstrap.complete");
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
