import { useState, useEffect, useCallback, useMemo, useReducer } from "react";
import { flushSync } from "react-dom";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import {
  registerAPI,
  loginAPI,
  oauthAPI,
  logoutAPIWithTimeout,
  refreshSessionAPI,
  patchMyOnboardingStatus,
  clearClientSessionRevoked,
  clearClientAuthStorage,
  isClientSessionRevoked,
  isMfaLoginChallenge,
  markLogoutPending,
  type AuthResponse,
  type LoginApiResult,
} from "../lib/api";
import { getMemoryAccessToken, subscribeMemoryAccessToken } from "../lib/accessTokenStore";
import {
  clearImpersonationAdminBackup,
  saveImpersonationAdminBackup,
  takeImpersonationAdminBackup,
} from "../lib/impersonationSessionBackup";
import { hasPendingStoredSessionWithoutUser } from "../lib/authRestore";
import {
  getAuthSessionFlags,
  markOnboardingStatusFromServer,
  markSessionBootstrapSettled,
  subscribeAuthSessionFlags,
} from "../lib/authSessionBootstrap";
import { normalizeStoredUser } from "../lib/authUserNormalize";
import { resolveAuthStatus, deriveAuthSession, type AuthSession, type AuthStatus, isPlatformAdminSessionRole } from "../lib/authSession";
import { isAuthBootstrapComplete } from "../lib/authBootstrapUi";
import { bumpSessionEpoch, getSessionEpoch } from "../lib/authSessionEpoch";
import {
  commitAuthUser,
  getAuthUser,
  setAuthUser,
  subscribeAuthUser,
} from "../lib/authUserStore";
import { clearEmployeeNotifications } from "../lib/employeeNotificationStore";
import { resetAllClientSessionCaches } from "../lib/resetAllClientSessionCaches";
import { performClientLogoutCleanup, captureLogoutSnapshot } from "../lib/clientLogout";
import {
  beginAuthLogoutTransition,
  isAuthLogoutTransitionActive,
} from "../lib/authLogoutTransition";
import { isIdleLogoutInFlight } from "../lib/idleSessionStore";
import { prefetchAuthLoginRoute } from "../routing/routeLazy";
import { markClientSessionHint } from "../lib/authSessionHint";
import { setMemoryAccessToken } from "../lib/accessTokenStore";
import { authDebug } from "../lib/authDebugLog";
import { logClientError } from "../lib/clientLog";
import {
  fallbackMessageForHttpStatus,
  SERVICE_UNAVAILABLE_CLIENT_MESSAGE,
  API_WAKEUP_NETWORK_MESSAGE,
} from "../lib/errorMessages";
import { AUTH_STORAGE_SYNC_EVENT, notifyAuthStorageSync } from "../lib/authStorageSync";

export type { AuthSession, AuthStatus } from "../lib/authSession";

const USER_STORAGE_KEY = "caretip_user";

function decodeJwtPayload(token: string): unknown | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, "=");
    const json = atob(padded);
    return JSON.parse(json) as unknown;
  } catch {
    return null;
  }
}

function isJwtExpired(token: string): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload !== "object") return false;
  const exp = (payload as { exp?: unknown }).exp;
  if (typeof exp !== "number") return false;
  return Date.now() >= exp * 1000;
}

function clearStoredSession(options?: { notifySync?: boolean }) {
  clearClientAuthStorage(options);
}

function loadUserFromStorage(): User | null {
  try {
    const saved = localStorage.getItem(USER_STORAGE_KEY);
    if (!saved) return null;
    return normalizeStoredUser(JSON.parse(saved) as unknown);
  } catch (err) {
    logClientError("useAuth.localStorage", err);
    return null;
  }
}

function notifyAuthStorageSyncFromHook() {
  notifyAuthStorageSync();
}

/** Persist in-memory access token + normalized user snapshot; user JSON aids bootstrap UX only. */
function persistAuthResponse(data: AuthResponse): User {
  resetAllClientSessionCaches();
  clearClientSessionRevoked();
  setMemoryAccessToken(data.token);
  const u = parseUser(data.user);
  localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(u));
  markClientSessionHint();
  markOnboardingStatusFromServer();
  notifyAuthStorageSyncFromHook();
  authDebug("auth_session_updated", { ...deriveAuthSession(u), source: "persist" });
  return u;
}

/** API roles plus demo-only values used by admin UI / RoleSwitcher */
export type UserRole = "business" | "employee" | "platform_admin" | "admin" | "user";

/** KYC gate for venue managers (`verified` in DB → APPROVED). */
export type BusinessAccountStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  /**
   * Mirrors backend `users.email_verified`. When false, app routes stay off dashboards until verified.
   * Must match the server; missing fields are treated as unverified for staff/manager roles (see {@link parseUser}).
   */
  emailVerified?: boolean;
  /** Preferred alias for UI logic. Always set from `emailVerified`. */
  isVerified: boolean;
  /** Used for business users to control whether `/onboarding` should show. */
  hasCompletedOnboarding: boolean;
  /** Alias: `hasCompletedOnboarding` — true only after explicit wizard finish. */
  onboardingCompleted: boolean;
  /** Resume step 1–3 from API (business managers only). */
  onboardingStep?: 1 | 2 | 3;
  businessId?: string;
  employeeId?: string;
  businessName?: string;
  avatar?: string;
  /** @deprecated Legacy KYC mirror — use `kycVerificationStatus` instead. */
  status?: BusinessAccountStatus;
  onboardingVerificationStatus?: import("../lib/api").OnboardingVerificationStatus;
  kycVerificationStatus?: import("../lib/api").KycVerificationStatus;
  /** True when platform admin is viewing as a business manager (JWT impersonation). */
  impersonation?: boolean;
  impersonatedBy?: string;
  preferredLocale?: string | null;
}

export interface RegisterPayload {
  email: string;
  password: string;
  name?: string;
  role: "business" | "employee";
  businessName?: string;
  businessType?: string;
  location?: string;
  inviteCode?: string;
}

export type RegisterResult = {
  requiresEmailVerification: true;
  email: string;
  role: UserRole;
};

/** Map Prisma / API role strings to UI `UserRole` (business / employee / platform_admin). */
function mapApiRoleToUserRole(apiRole: string): UserRole {
  switch (apiRole) {
    case "SUPER_ADMIN":
      return "platform_admin";
    case "MANAGER":
      return "business";
    case "EMPLOYEE":
      return "employee";
    default:
      return apiRole as UserRole;
  }
}

/** Normalize API auth user payloads for UI state (login, refresh, impersonation). */
export function userFromAuthResponse(data: AuthResponse["user"]): User {
  return parseUser(data);
}

export function parseUser(data: AuthResponse["user"]): User {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid auth response: missing user profile.");
  }
  const ext = data as AuthResponse["user"] & {
    impersonation?: boolean;
    impersonatedBy?: string;
    preferredLocale?: string | null;
    onboardingVerificationStatus?: import("../lib/api").OnboardingVerificationStatus;
    kycVerificationStatus?: import("../lib/api").KycVerificationStatus;
  };
  const role = mapApiRoleToUserRole(data.role);
  /** Only verified when the API sends `true`. Missing/false keeps users on the verify-email gate until refresh matches the DB. */
  const emailVerified =
    typeof ext.emailVerified === "boolean"
      ? ext.emailVerified
      : role === "platform_admin" || role === "admin";
  const isVerified = emailVerified;
  const hasCompletedOnboarding =
    role === "business" ? (typeof ext.hasCompletedOnboarding === "boolean" ? ext.hasCompletedOnboarding : false) : true;
  const onboardingStepRaw = (ext as { onboardingStep?: unknown }).onboardingStep;
  const onboardingStep =
    role === "business" &&
    typeof onboardingStepRaw === "number" &&
    onboardingStepRaw >= 1 &&
    onboardingStepRaw <= 3
      ? (onboardingStepRaw as 1 | 2 | 3)
      : undefined;
  const base: User = {
    id: data.id,
    name: data.name,
    email: data.email,
    role,
    emailVerified,
    isVerified,
    hasCompletedOnboarding,
    onboardingCompleted: hasCompletedOnboarding,
    onboardingStep,
    businessId: data.businessId,
    employeeId: data.employeeId,
    // Auth DTO uses `name` for the venue on managers; keep `businessName` in sync for QR / Studio.
    businessName:
      typeof (data as { businessName?: string }).businessName === "string"
        ? (data as { businessName?: string }).businessName
        : role === "business"
          ? data.name
          : undefined,
    avatar: data.avatar ?? undefined,
    impersonation: ext.impersonation,
    impersonatedBy: ext.impersonatedBy,
    preferredLocale: typeof ext.preferredLocale === "string" ? ext.preferredLocale : null,
    onboardingVerificationStatus: ext.onboardingVerificationStatus,
    kycVerificationStatus: ext.kycVerificationStatus,
  };
  // Super admins must not carry business/employee scope in client state (API maps SUPER_ADMIN → platform_admin).
  if (role === "platform_admin" && !ext.impersonation) {
    return { ...base, businessId: undefined, employeeId: undefined, businessName: undefined, status: undefined };
  }
  return base;
}

export { getPostAuthRedirect } from "../lib/authRedirects";

function requestEmailLocale(i18nLang: string | undefined): "en" | "de" {
  return i18nLang?.toLowerCase().startsWith("de") ? "de" : "en";
}

function isTransientRefreshErrorMessage(msg: string): boolean {
  return (
    msg === SERVICE_UNAVAILABLE_CLIENT_MESSAGE ||
    msg === API_WAKEUP_NETWORK_MESSAGE ||
    msg === fallbackMessageForHttpStatus(500) ||
    msg === fallbackMessageForHttpStatus(502) ||
    msg === fallbackMessageForHttpStatus(503) ||
    msg === fallbackMessageForHttpStatus(504) ||
    msg === fallbackMessageForHttpStatus(429)
  );
}

export type ExitImpersonationResult = "restored" | "login_required";

/**
 * Rehydrate the platform-admin session after impersonation.
 * 1) In-memory / sessionStorage backup from impersonate start
 * 2) HttpOnly refresh cookie (still belongs to the platform admin during impersonation)
 */
export async function restorePlatformAdminSession(): Promise<boolean> {
  const backup = takeImpersonationAdminBackup();
  if (backup) {
    resetAllClientSessionCaches();
    clearClientSessionRevoked();
    setMemoryAccessToken(backup.token);
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(backup.user));
    markClientSessionHint();
    bumpSessionEpoch();
    commitAuthUser(backup.user);
    markSessionBootstrapSettled();
    notifyAuthStorageSync();
    authDebug("auth_session_updated", {
      ...deriveAuthSession(backup.user),
      source: "exit_impersonation_backup",
    });
    return isPlatformAdminSessionRole(backup.user.role);
  }

  try {
    const data = await refreshSessionAPI();
    const restored = parseUser(data.user);
    if (!isPlatformAdminSessionRole(restored.role)) {
      return false;
    }
    resetAllClientSessionCaches();
    clearClientSessionRevoked();
    setMemoryAccessToken(data.token);
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(restored));
    markClientSessionHint();
    markOnboardingStatusFromServer();
    bumpSessionEpoch();
    commitAuthUser(restored);
    markSessionBootstrapSettled();
    notifyAuthStorageSync();
    authDebug("auth_session_updated", {
      ...deriveAuthSession(restored),
      source: "exit_impersonation_refresh",
    });
    return true;
  } catch (err) {
    logClientError("useAuth.restorePlatformAdminSession", err);
    return false;
  }
}

export function useAuth() {
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const requestLocale = requestEmailLocale(i18n.resolvedLanguage);
  const [user, setUserSnapshot] = useState<User | null>(() => getAuthUser());
  const [, syncAuthFlags] = useReducer((n: number) => n + 1, 0);
  const { authHydrated, sessionValidated } = getAuthSessionFlags();
  /** Re-read in-memory access token so proactive refresh tracks rotation after login/refresh. */
  const accessTokenSnapshot = getMemoryAccessToken();

  useEffect(() => subscribeAuthUser(() => setUserSnapshot(getAuthUser())), []);
  useEffect(() => subscribeAuthSessionFlags(() => syncAuthFlags()), []);
  useEffect(() => subscribeMemoryAccessToken(() => syncAuthFlags()), []);

  useEffect(() => {
    const onStorageSync = () => {
      // Storage was already cleared by whoever dispatched the sync event — do not call
      // clearStoredSession() here or every listener re-dispatches and causes stack overflow.
      if (isClientSessionRevoked()) {
        setAuthUser(null);
        return;
      }
      setAuthUser(loadUserFromStorage());
    };
    window.addEventListener(AUTH_STORAGE_SYNC_EVENT, onStorageSync);
    return () => window.removeEventListener(AUTH_STORAGE_SYNC_EVENT, onStorageSync);
  }, []);

  /** Proactively refresh shortly before access token expiry so API calls rarely see 401. */
  useEffect(() => {
    if (!user || !accessTokenSnapshot || !sessionValidated) return;
    const payload = decodeJwtPayload(accessTokenSnapshot);
    if (!payload || typeof payload !== "object") return;
    const exp = (payload as { exp?: unknown }).exp;
    if (typeof exp !== "number") return;
    const renewSkewMs = 90_000;
    const delay = Math.max(4_000, exp * 1000 - Date.now() - renewSkewMs);
    let cancelled = false;
    const id = window.setTimeout(() => {
      void (async () => {
        if (cancelled) return;
        // Idle logout in flight: do not refresh / resurrect the session being torn down.
        if (isIdleLogoutInFlight()) return;
        try {
          const data = await refreshSessionAPI();
          bumpSessionEpoch();
          const u = persistAuthResponse(data);
          if (!cancelled && !isIdleLogoutInFlight()) commitAuthUser(u);
        } catch {
          // Leave handling to the next API 401 + silent refresh, or bootstrap on reload.
        }
      })();
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [user?.id, accessTokenSnapshot, sessionValidated]);

  useEffect(() => {
    if (!authHydrated || !sessionValidated) return;
    if (user) {
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
      return;
    }
    try {
      if (localStorage.getItem(USER_STORAGE_KEY)) {
        clearStoredSession({ notifySync: false });
      }
    } catch {
      // ignore
    }
  }, [user, authHydrated, sessionValidated]);

  const login = useCallback(async (email: string, password: string): Promise<LoginApiResult> => {
    const data = await loginAPI(email, password, requestLocale);
    if (isMfaLoginChallenge(data)) {
      return data;
    }
    const u = persistAuthResponse(data);
    bumpSessionEpoch();
    commitAuthUser(u);
    markSessionBootstrapSettled();
    return data;
  }, [requestLocale]);

  const register = useCallback(async (payload: RegisterPayload): Promise<RegisterResult> => {
    const data = await registerAPI({ ...payload, locale: requestLocale });
    clearStoredSession();
    commitAuthUser(null);
    markSessionBootstrapSettled();
    return {
      requiresEmailVerification: true,
      email: data.user.email,
      role: mapApiRoleToUserRole(data.user.role),
    };
  }, [requestLocale]);

  const loginWithOAuth = useCallback(async (
    provider: "google",
    idToken: string,
    options: {
      isLogin: boolean;
      intendedRole?: "business" | "employee";
      name?: string;
      businessName?: string;
      businessType?: string;
      location?: string;
      inviteCode?: string;
    }
  ): Promise<User> => {
    const data = await oauthAPI({
      provider,
      idToken,
      isLogin: options.isLogin,
      ...(options.intendedRole ? { intendedRole: options.intendedRole } : {}),
      name: options.name,
      businessName: options.businessName,
      businessType: options.businessType,
      location: options.location,
      inviteCode: options.inviteCode,
      locale: requestLocale,
    });
    const u = persistAuthResponse(data);
    bumpSessionEpoch();
    commitAuthUser(u);
    markSessionBootstrapSettled();
    return u;
  }, [requestLocale]);

  const completeAuthLogin = useCallback((data: AuthResponse): User => {
    const u = persistAuthResponse(data);
    bumpSessionEpoch();
    commitAuthUser(u);
    markSessionBootstrapSettled();
    return u;
  }, []);

  const logout = useCallback(() => {
    if (isAuthLogoutTransitionActive()) return;

    const clickStartedAt = performance.now();
    authDebug("logout_click", { t: clickStartedAt });

    const snapshot = captureLogoutSnapshot();
    // Force AppLoadingManager + guards to commit overlay cover before session teardown / RR transition.
    flushSync(() => {
      beginAuthLogoutTransition(snapshot.loginPath);
    });
    markLogoutPending();
    // Warm the same lazy promise RR will await so logout overlay covers chunk+CSS load.
    prefetchAuthLoginRoute(snapshot.loginPath);

    // Clear session before route swap so AuthPage never paints authenticated chrome mid-handoff.
    const { clientCleanupMs } = performClientLogoutCleanup(snapshot);

    flushSync(() => {
      navigate(snapshot.loginPath, { replace: true });
    });

    // Overlay ends when the login surface paints (signalLogoutAuthPageReady) — not here.
    authDebug("logout_navigate", {
      loginPath: snapshot.loginPath,
      clientCleanupMs: Math.round(clientCleanupMs),
      msSinceClick: Math.round(performance.now() - clickStartedAt),
    });

    void logoutAPIWithTimeout({
      capturedToken: snapshot.capturedAccessToken,
      clickStartedAt,
    });
  }, [navigate]);

  const switchRole = (newRole: UserRole) => {
    if (user) {
      setAuthUser({ ...user, role: newRole });
    }
  };

  const isBusiness = user?.role === "business";
  const isEmployee = user?.role === "employee";
  const isPlatformAdmin = user?.role === "platform_admin";

  /** Restore platform admin session after impersonation and route to the admin shell. */
  const exitImpersonation = useCallback(async (): Promise<ExitImpersonationResult> => {
    const restored = await restorePlatformAdminSession();
    if (restored) {
      navigate("/platform-admin", { replace: true });
      return "restored";
    }

    resetAllClientSessionCaches();
    clearImpersonationAdminBackup();
    clearStoredSession();
    commitAuthUser(null);
    markSessionBootstrapSettled();
    notifyAuthStorageSyncFromHook();
    navigate("/platform-admin/login", {
      replace: true,
      state: { forceLogin: true, impersonationExitFailed: true },
    });
    return "login_required";
  }, [navigate]);

  const updateUser = useCallback((patch: Partial<User>) => {
    const current = getAuthUser();
    if (!current) {
      setAuthUser(null);
      return;
    }
    const next = { ...current, ...patch };
    try {
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(next));
    } catch (err) {
      logClientError("useAuth.updateUser", err);
    }
    if ("avatar" in patch || "name" in patch) {
      commitAuthUser(next);
    } else {
      setAuthUser(next);
    }
  }, []);

  const setHasCompletedOnboarding = useCallback(async (next: boolean): Promise<User> => {
    try {
      const data = await patchMyOnboardingStatus(next);
      const u = persistAuthResponse(data);
      bumpSessionEpoch();
      commitAuthUser(u);
      return u;
    } catch (err) {
      logClientError("useAuth.setHasCompletedOnboarding", err);
      throw err;
    }
  }, []);

  const replaceUser = useCallback((next: User) => {
    localStorage.setItem("caretip_user", JSON.stringify(next));
    bumpSessionEpoch();
    commitAuthUser(next);
    markSessionBootstrapSettled();
    notifyAuthStorageSyncFromHook();
  }, []);

  /** Apply a server AuthResponse (e.g. mobile→web handoff consume) as the active web session. */
  const establishExternalSession = useCallback((data: AuthResponse): User => {
    const u = persistAuthResponse(data);
    bumpSessionEpoch();
    commitAuthUser(u);
    markSessionBootstrapSettled();
    return u;
  }, []);

  const refreshSession = useCallback(async (): Promise<User | null> => {
    try {
      const data = await refreshSessionAPI();
      const u = persistAuthResponse(data);
      bumpSessionEpoch();
      commitAuthUser(u);
      markSessionBootstrapSettled();
      return u;
    } catch (err) {
      logClientError("useAuth.refreshSession", err);
      const msg = err instanceof Error ? err.message : "";
      if (msg === SERVICE_UNAVAILABLE_CLIENT_MESSAGE) {
        toast.error(SERVICE_UNAVAILABLE_CLIENT_MESSAGE, { id: "caretip-auth-refresh-503" });
      }
      if (isTransientRefreshErrorMessage(msg)) {
        return loadUserFromStorage();
      }
      clearStoredSession();
      commitAuthUser(null);
      markSessionBootstrapSettled();
      return null;
    }
  }, []);

  /** Re-fetch the current session from the server (same as refreshSession). */
  const refetchUser = refreshSession;

  const authReady = authHydrated && sessionValidated;

  const authStatus: AuthStatus = useMemo(
    () =>
      resolveAuthStatus(user, {
        authHydrated,
        sessionValidated,
        pendingStoredSession: hasPendingStoredSessionWithoutUser(user),
      }),
    [user, authHydrated, sessionValidated],
  );

  const authState = useMemo(
    () => ({
      user,
      isAuthenticated: authStatus === "authenticated",
      isLoading: authStatus === "initializing",
      status: authStatus,
    }),
    [user, authStatus],
  );

  return {
    user,
    /** True when bootstrap finished — safe to run protected API hooks (notifications, stats). */
    authReady,
    /** True after refresh/bootstrap hydration completes (inverse of authStatus === "initializing"). */
    authBootstrapComplete: isAuthBootstrapComplete(authStatus),
    /** @deprecated Prefer `authState.isLoading` or `!authReady`. */
    isLoadingUser: authStatus === "initializing",
    /** True while session restoration is in flight; route guards must wait and must not redirect. */
    isAuthLoading: authStatus === "initializing",
    /** Canonical lifecycle: initializing → authenticated | unauthenticated */
    authStatus,
    authHydrated,
    /** @deprecated Always false; silent refresh — do not gate UI on this. */
    sessionChecking: false,
    /** True after bootstrap refresh completes (success, invalid, or transient). */
    sessionValidated,
    authState,
    isBusiness,
    isEmployee,
    isPlatformAdmin,
    login,
    register,
    loginWithOAuth,
    logout,
    refreshSession,
    refetchUser,
    switchRole,
    updateUser,
    setHasCompletedOnboarding,
    replaceUser,
    establishExternalSession,
    completeAuthLogin,
    exitImpersonation,
  };
}

/** Canonical auth flags derived from `useAuth().user` (single model for UI + tests). */
export function useAuthSession(): AuthSession {
  const { user } = useAuth();
  return useMemo(() => deriveAuthSession(user), [user]);
}
