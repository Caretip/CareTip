import { useEffect } from "react";

import { toast } from "sonner";

import {
  bootstrapRefreshSession,
  clearClientAuthStorage,
  clearClientSessionRevoked,
  isClientSessionRevoked,
  markClientSessionRevoked,
  refreshSessionAPI,
} from "../lib/api";
import { ensureAuthSessionBootstrap } from "../lib/authBootstrap";
import {
  getAuthSessionFlags,
  markOnboardingStatusFromServer,
  markSessionBootstrapDegraded,
  markSessionBootstrapSettled,
} from "../lib/authSessionBootstrap";
import { bumpSessionEpoch, getSessionEpoch } from "../lib/authSessionEpoch";
import { setAuthUser } from "../lib/authUserStore";
import { setMemoryAccessToken } from "../lib/accessTokenStore";

import { authDebug } from "../lib/authDebugLog";

import { logClientError } from "../lib/clientLog";

import {
  traceSessionValidationCompleted,
  traceSessionValidationStarted,
  warnLoaderStuck,
} from "../lib/loadingStateDiagnostics";

import { SERVICE_UNAVAILABLE_CLIENT_MESSAGE } from "../lib/errorMessages";
import { isDefinitiveRefreshFailure } from "../lib/authRefreshFailureClassification";

import type { SessionBootstrapResult } from "../lib/authSessionBootstrap";

import type { AuthResponse, BootstrapRefreshResult } from "../lib/api";

import { parseUser, type User } from "./useAuth";

import { normalizeStoredUser } from "../lib/authUserNormalize";
import {
  markClientSessionHint,
  shouldAttemptBootstrapRefresh,
} from "../lib/authSessionHint";

const USER_STORAGE_KEY = "caretip_user";

const TRANSIENT_BOOTSTRAP_RETRY_MS = 4_000;
const TRANSIENT_BOOTSTRAP_RETRY_MAX = 8;
/** Never block the shell longer than this waiting on /api/auth/refresh. */
const BOOTSTRAP_REFRESH_TIMEOUT_MS = 12_000;
/** After transient refresh failure, unblock the shell in degraded mode (no forced logout). */
const TRANSIENT_DEGRADED_SETTLE_MS = 12_000;

function loadUserFromStorage(): User | null {
  try {
    const saved = localStorage.getItem(USER_STORAGE_KEY);
    if (!saved) return null;
    return normalizeStoredUser(JSON.parse(saved) as unknown);
  } catch (err) {
    logClientError("useAuthInitializer.localStorage", err);
    return null;
  }
}

function clearStoredSession() {
  clearClientAuthStorage();
}

function persistAuthResponse(data: AuthResponse): User {
  clearClientSessionRevoked();
  setMemoryAccessToken(data.token);
  const u = parseUser(data.user);
  localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(u));
  markClientSessionHint();
  markOnboardingStatusFromServer();
  return u;
}

function settleTransientBootstrapDegraded(reason: string): SessionBootstrapResult {
  authDebug("session_bootstrap", { outcome: reason });
  warnLoaderStuck("session-bootstrap-degraded", { reason, ...getAuthSessionFlags() });
  const stored = loadUserFromStorage();
  if (stored) setAuthUser(stored);
  markSessionBootstrapDegraded();
  traceSessionValidationCompleted(true);
  return { kind: "transient_error" };
}

function forceDefinitiveLogout(reason: string): SessionBootstrapResult {
  authDebug("session_bootstrap", { outcome: reason });
  clearStoredSession();
  markClientSessionRevoked();
  setAuthUser(null);
  markSessionBootstrapSettled();
  traceSessionValidationCompleted(true);
  return { kind: "unauthenticated" };
}

async function bootstrapRefreshWithTimeout(
  hadLocalSession: boolean,
): Promise<BootstrapRefreshResult> {
  traceSessionValidationStarted();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutPromise = new Promise<BootstrapRefreshResult>((resolve) => {
      timeoutId = setTimeout(() => {
        authDebug("session_bootstrap", { outcome: "refresh_timeout", hadLocalSession });
        resolve(hadLocalSession ? { kind: "transient_error" } : { kind: "unauthenticated" });
      }, BOOTSTRAP_REFRESH_TIMEOUT_MS);
    });
    return await Promise.race([bootstrapRefreshSession(), timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

/** Apply bootstrap off the React commit phase — use setAuthUser, not flushSync commitAuthUser. */
function applyBootstrapResult(result: SessionBootstrapResult, epochAtStart: number): void {
  if (getSessionEpoch() !== epochAtStart) {
    markSessionBootstrapSettled();
    return;
  }

  if (result.kind === "authenticated") {
    setAuthUser(persistAuthResponse(result.data));
    markOnboardingStatusFromServer();
    markSessionBootstrapSettled();
    traceSessionValidationCompleted(true);
    return;
  }

  if (result.kind === "unauthenticated") {
    setAuthUser(null);
    markSessionBootstrapSettled();
    traceSessionValidationCompleted(true);
    return;
  }

  const stored = loadUserFromStorage();
  setAuthUser(stored);
}

/**
 * Runs once at app root — restores session from storage + POST /api/auth/refresh before route guards redirect.
 */
export function useAuthInitializer(): void {
  useEffect(() => {
    let transientRetryTimer: number | null = null;
    let transientSettleTimer: number | null = null;
    let transientRetryAttempt = 0;

    const clearTransientTimers = () => {
      if (transientRetryTimer != null) {
        window.clearTimeout(transientRetryTimer);
        transientRetryTimer = null;
      }
      if (transientSettleTimer != null) {
        window.clearTimeout(transientSettleTimer);
        transientSettleTimer = null;
      }
    };

    const scheduleTransientRetry = (epochAtStart: number, delayMs: number) => {
      transientRetryTimer = window.setTimeout(() => {
        transientRetryTimer = null;
        if (getSessionEpoch() !== epochAtStart) return;
        if (getAuthSessionFlags().sessionValidated && !getAuthSessionFlags().sessionConnectivityDegraded) {
          return;
        }

        void refreshSessionAPI()
          .then((data) => {
            if (getSessionEpoch() !== epochAtStart) return;
            clearTransientTimers();
            transientRetryAttempt = 0;
            setAuthUser(persistAuthResponse(data));
            markOnboardingStatusFromServer();
            markSessionBootstrapSettled();
            traceSessionValidationCompleted(true);
          })
          .catch((err) => {
            if (getSessionEpoch() !== epochAtStart) return;
            if (getAuthSessionFlags().sessionValidated && !getAuthSessionFlags().sessionConnectivityDegraded) {
              return;
            }
            if (isDefinitiveRefreshFailure(err)) {
              clearTransientTimers();
              applyBootstrapResult(forceDefinitiveLogout("transient_retry_auth_invalid"), epochAtStart);
              return;
            }
            transientRetryAttempt += 1;
            if (transientRetryAttempt >= TRANSIENT_BOOTSTRAP_RETRY_MAX) {
              applyBootstrapResult(settleTransientBootstrapDegraded("transient_retry_exhausted"), epochAtStart);
              scheduleTransientRetry(epochAtStart, TRANSIENT_BOOTSTRAP_RETRY_MS * 4);
              return;
            }
            scheduleTransientRetry(epochAtStart, TRANSIENT_BOOTSTRAP_RETRY_MS);
          });
      }, delayMs);
    };

    const scheduleTransientRecovery = (epochAtStart: number) => {
      clearTransientTimers();

      transientSettleTimer = window.setTimeout(() => {
        transientSettleTimer = null;
        if (getSessionEpoch() !== epochAtStart) return;
        if (getAuthSessionFlags().sessionValidated) return;
        applyBootstrapResult(settleTransientBootstrapDegraded("transient_settle_degraded"), epochAtStart);
      }, TRANSIENT_DEGRADED_SETTLE_MS);

      scheduleTransientRetry(epochAtStart, TRANSIENT_BOOTSTRAP_RETRY_MS);
    };

    ensureAuthSessionBootstrap(
      async () => {
        if (isClientSessionRevoked()) {
          clearStoredSession();
          return { kind: "unauthenticated" };
        }

        const hadLocalSession = Boolean(loadUserFromStorage());

        if (hadLocalSession) {
          const cached = loadUserFromStorage();
          if (cached) setAuthUser(cached);
        }

        if (!shouldAttemptBootstrapRefresh(hadLocalSession)) {
          authDebug("session_bootstrap", { outcome: "anonymous_skip_refresh" });
          return { kind: "unauthenticated" };
        }

        const refresh = await bootstrapRefreshWithTimeout(hadLocalSession);
        if (refresh.kind === "authenticated") {
          return { kind: "authenticated", data: refresh.data };
        }

        if (refresh.kind === "transient_error") {
          if (hadLocalSession) {
            toast.error(SERVICE_UNAVAILABLE_CLIENT_MESSAGE, { id: "caretip-auth-refresh-503" });
            authDebug("session_bootstrap", { outcome: "transient_error" });
            logClientError(
              "useAuthInitializer.sessionBootstrap.transient",
              new Error("bootstrap refresh transient failure"),
            );
            return { kind: "transient_error" };
          }
          authDebug("session_bootstrap", { outcome: "anonymous_transient_error" });
          return { kind: "unauthenticated" };
        }

        if (hadLocalSession) {
          authDebug("session_bootstrap", { outcome: "expired_local_session" });
          clearStoredSession();
          markClientSessionRevoked();
        } else {
          authDebug("session_bootstrap", { outcome: "anonymous_no_refresh_session" });
        }
        return { kind: "unauthenticated" };
      },
      (result, epochAtStart) => {
        applyBootstrapResult(result, epochAtStart);
        if (result.kind === "transient_error") {
          scheduleTransientRecovery(epochAtStart);
        } else {
          clearTransientTimers();
        }
      },
    );

    return () => {
      clearTransientTimers();
    };
  }, []);
}
