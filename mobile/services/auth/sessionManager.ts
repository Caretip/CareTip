import { authService } from "@/services/auth/authService";
import {
  clearReactQueryForAuthBoundary,
  establishAuthenticatedSession,
} from "@/services/auth/authCacheBoundary";
import {
  clearAllSessionSecrets,
  getAccessToken,
  getRefreshToken,
  getUserSnapshot,
} from "@/services/auth/tokenStorage";
import {
  hydrateAccessTokenFromSecureStore,
  setMemoryAccessToken,
} from "@/services/api/client";
import { useAuthStore } from "@/store/authStore";
import { useUserStore } from "@/store/userStore";
import { useBusinessStore } from "@/store/businessStore";
import { useEmployeeStore } from "@/store/employeeStore";
import { unregisterPushToken } from "@/services/api/settingsService";
import { getRegisteredPushToken, setRegisteredPushToken } from "@/utils/pushTokenRegistry";
import { clearAllOfflineQrCaches } from "@/utils/offlineQrCache";
import { clearOsNotificationBadge } from "@/utils/notificationBadge";
import { logAuthEvent } from "@/utils/authDebug";
import { STARTUP_TASK_TIMEOUT_MS } from "@/constants/startup";
import { withTimeout } from "@/utils/withTimeout";
import { useStartupStore } from "@/store/startupStore";

/**
 * Session manager — cold-start bootstrap + sign-out.
 * Phase 2.4: never setAuthenticated until POST /api/auth/refresh returns
 * a server AuthResponse (token + AuthUser). Cached JWT / snapshot are hints only.
 */

let bootstrapPromise: Promise<void> | null = null;

async function readLocalSecrets(): Promise<{
  access: string | null;
  refresh: string | null;
  cachedUser: Awaited<ReturnType<typeof getUserSnapshot>>;
}> {
  await withTimeout(
    hydrateAccessTokenFromSecureStore(),
    STARTUP_TASK_TIMEOUT_MS,
    "secureStore.hydrate",
  );
  const [access, refresh, cachedUser] = await Promise.all([
    withTimeout(getAccessToken(), STARTUP_TASK_TIMEOUT_MS, "secureStore.accessToken"),
    withTimeout(getRefreshToken(), STARTUP_TASK_TIMEOUT_MS, "secureStore.refreshToken"),
    withTimeout(getUserSnapshot(), STARTUP_TASK_TIMEOUT_MS, "secureStore.userSnapshot"),
  ]);
  return { access, refresh, cachedUser };
}

async function clearLocalAuthState(reason: string): Promise<void> {
  setMemoryAccessToken(null);
  try {
    await clearAllSessionSecrets();
  } catch {
    /* continue */
  }
  clearReactQueryForAuthBoundary("logout");
  try {
    await clearAllOfflineQrCaches();
  } catch {
    /* non-fatal */
  }
  useUserStore.getState().clear();
  useBusinessStore.getState().clear();
  useEmployeeStore.getState().clear();
  useAuthStore.getState().setUnauthenticated();
  logAuthEvent("bootstrap.cleared", { reason });
}

async function enterSessionRecovery(reason: string): Promise<void> {
  // Keep SecureStore secrets for retry; strip in-memory auth so no shell can mount.
  setMemoryAccessToken(null);
  useUserStore.getState().clear();
  useAuthStore.getState().setSessionRecovery();
  logAuthEvent("bootstrap.session_recovery", { reason });
}

async function runBootstrap(): Promise<void> {
  const auth = useAuthStore.getState();
  auth.setStatus("bootstrapping");
  logAuthEvent("bootstrap.start");

  try {
    const { access, refresh, cachedUser } = await readLocalSecrets();
    const hasSecrets = Boolean(access || refresh || cachedUser);

    if (!hasSecrets) {
      useUserStore.getState().clear();
      auth.setUnauthenticated();
      logAuthEvent("bootstrap.unauthenticated", { reason: "no-local-secrets" });
      return;
    }

    // Snapshot is never used to authorize — only for optional recovery UI copy later.
    void cachedUser;

    const result = await withTimeout(
      authService.validateBootstrapSession(),
      STARTUP_TASK_TIMEOUT_MS,
      "auth.validateBootstrapSession",
    );

    if (result.status === "authenticated") {
      await establishAuthenticatedSession(
        result.session.token,
        result.session.user,
        "session-restore",
        { clearOfflineQr: false },
      );
      logAuthEvent("bootstrap.authenticated", {
        via: "refresh",
        userId: result.session.user.id,
        role: result.session.user.role,
      });
      return;
    }

    if (result.status === "offline" || result.status === "no-secrets") {
      if (result.status === "no-secrets") {
        await clearLocalAuthState("no-secrets-after-hydrate");
        return;
      }
      await enterSessionRecovery("offline");
      return;
    }

    // rejected — expired / revoked / deleted / disabled
    await clearLocalAuthState("refresh-rejected");
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    logAuthEvent("bootstrap.error", { message });
    const access = await getAccessToken().catch(() => null);
    const refresh = await getRefreshToken().catch(() => null);
    if (access || refresh) {
      await enterSessionRecovery("bootstrap-error-or-timeout");
    } else {
      await clearLocalAuthState("bootstrap-error");
    }
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
          // Phase 2.4 — never authenticate from cached JWT on timeout.
          setMemoryAccessToken(null);
          useUserStore.getState().clear();
          auth.setSessionRecovery();
          logAuthEvent("bootstrap.session_recovery", { reason: "timeout" });
        }
      });
    } catch {
      if (!useAuthStore.getState().isHydrated) {
        const access = await getAccessToken().catch(() => null);
        const refresh = await getRefreshToken().catch(() => null);
        if (access || refresh) {
          setMemoryAccessToken(null);
          useUserStore.getState().clear();
          useAuthStore.getState().setSessionRecovery();
          logAuthEvent("bootstrap.session_recovery", { reason: "timeout-catch" });
        } else {
          useUserStore.getState().clear();
          useAuthStore.getState().setUnauthenticated();
        }
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

/** Retry after offline / timeout recovery — requires backend validation again. */
export async function retryBootstrapSession(): Promise<void> {
  useStartupStore.getState().reset();
  await bootstrapSession();
}

/** Abandon recovery and force login (clears local secrets). */
export async function abandonSessionRecovery(): Promise<void> {
  await clearLocalAuthState("recovery-abandoned");
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

  // Flip auth first so `(app)` redirects away before caches/stores empty under a mounted dashboard.
  useAuthStore.getState().setUnauthenticated();
  useUserStore.getState().clear();
  useBusinessStore.getState().clear();
  useEmployeeStore.getState().clear();

  clearReactQueryForAuthBoundary("logout");
  try {
    await clearAllOfflineQrCaches();
  } catch {
    /* Non-fatal — session secrets already cleared. */
  }
  void clearOsNotificationBadge();
}

export const sessionManager = {
  bootstrapSession,
  retryBootstrapSession,
  abandonSessionRecovery,
  signOut,
};
