import { API_ENDPOINTS } from "@/constants/endpoints";
import {
  apiClient,
  getMemoryAccessToken,
  persistRefreshFromResponse,
  refreshAccessToken,
  setMemoryAccessToken,
} from "@/services/api/client";
import {
  clearAllSessionSecrets,
  getRefreshToken,
  saveAccessToken,
  saveUserSnapshot,
} from "@/services/auth/tokenStorage";
import { buildRefreshCookieHeader } from "@/utils/refreshCookie";
import {
  headerLookup,
  logAuthEvent,
  logAuthTokenState,
  logLoginTrace,
  serializeResponseHeaders,
} from "@/utils/authDebug";
import { config } from "@/constants/config";
import type { AuthResponse, SignInRequest, SignInResult } from "@/types/auth";
import { isMfaChallenge } from "@/types/auth";
import { normalizeApiError } from "@/types/api";

/**
 * Auth API — reuses existing backend routes only.
 * No client-side business-rule duplication.
 */

async function persistSession(data: AuthResponse): Promise<AuthResponse> {
  setMemoryAccessToken(data.token);
  await saveAccessToken(data.token);
  await saveUserSnapshot(data.user);
  logAuthTokenState("session.persisted", data.token);
  return data;
}

/**
 * Password login — same contract as web `loginAPI`:
 * POST /api/auth/signin → store access JWT → return.
 * Does NOT treat /api/auth/refresh failures as login failures (web never calls refresh after sign-in).
 */
export async function login(payload: SignInRequest): Promise<SignInResult> {
  const requestUrl = `${config.apiUrl}${API_ENDPOINTS.auth.signIn}`;
  logAuthEvent("login.request", {
    method: "POST",
    url: requestUrl,
    path: API_ENDPOINTS.auth.signIn,
    bodyKeys: Object.keys(payload),
    hasPassword: Boolean(payload.password),
    emailLen: payload.email?.trim().length ?? 0,
  });

  const response = await apiClient.post<SignInResult>(API_ENDPOINTS.auth.signIn, payload);
  const headerMap = serializeResponseHeaders(response.headers);

  logAuthEvent("login.response", {
    status: response.status,
    requestUrl,
    headerKeys: Object.keys(headerMap),
    /** Never log raw Set-Cookie / refresh header values — keys only. */
    hasSetCookie: Boolean(
      headerLookup(headerMap, "set-cookie") ?? headerLookup(headerMap, "Set-Cookie"),
    ),
    hasRefreshHeader: Boolean(
      headerLookup(headerMap, "x-caretip-refresh") ?? headerLookup(headerMap, "X-CareTip-Refresh"),
    ),
  });

  const hasRefreshHeader = Boolean(
    headerLookup(headerMap, "x-caretip-refresh") ?? headerLookup(headerMap, "X-CareTip-Refresh"),
  );
  const hasSetCookie = Boolean(
    headerLookup(headerMap, "set-cookie") ?? headerLookup(headerMap, "Set-Cookie"),
  );

  const refreshPersisted = await persistRefreshFromResponse(response.headers);
  const secureStoreReadBack = Boolean(await getRefreshToken());

  const data = response.data;
  const hasAccessToken = Boolean(data && typeof data === "object" && "token" in data && data.token);

  logAuthEvent("login.verify", {
    hasAccessToken,
    hasRefreshHeader,
    hasSetCookie,
    refreshPersisted,
    secureStoreReadBack,
  });

  if (isMfaChallenge(data)) {
    logAuthEvent("login.mfa.challenge");
    return data;
  }

  if (!hasAccessToken || !("user" in data)) {
    throw normalizeApiError(new Error("Login succeeded without access token."));
  }

  // Match web: access token from signin is enough to enter the app.
  await persistSession(data);

  // Optional continuity check — never fail the login UX on refresh errors.
  let refreshEndpointSuccess = false;
  if (secureStoreReadBack) {
    try {
      const refreshed = await refreshSession();
      refreshEndpointSuccess = Boolean(refreshed?.token);
    } catch (error) {
      logAuthEvent("login.post.refresh.failed", {
        message: normalizeApiError(error).message,
        note: "Sign-in still succeeds; refresh is session continuity only.",
      });
    }
  } else {
    logAuthEvent("login.post.refresh.skipped", {
      reason: "no-refresh-token-in-SecureStore",
      hasRefreshHeader,
      hasSetCookie,
    });
  }

  logLoginTrace({
    hasAccessToken: true,
    hasRefreshHeader,
    hasSetCookie,
    refreshPersisted,
    secureStoreReadBack: Boolean(await getRefreshToken()),
    refreshEndpointSuccess,
  });

  logAuthEvent("login.ready.for.dashboard", {
    requestUrl,
    hasRefreshInSecureStore: Boolean(await getRefreshToken()),
    refreshEndpointSuccess,
  });

  return data;
}

/**
 * Rotates access JWT via POST /api/auth/refresh.
 * Prefer SecureStore-mirrored `caretip_refresh` cookie; Bearer grace path as fallback.
 */
export async function refreshSession(): Promise<AuthResponse | null> {
  const refreshToken = await getRefreshToken();
  const access = getMemoryAccessToken();
  const headers: Record<string, string> = {
    [config.clientHeaderName]: config.clientHeader,
    "Content-Type": "application/json",
  };
  if (refreshToken) {
    headers.Cookie = buildRefreshCookieHeader(refreshToken);
  }
  // Explicit Bearer for refresh grace path (same as web when cookie missing).
  if (access) {
    headers.Authorization = `Bearer ${access}`;
  }

  logAuthEvent("refresh.attempt", {
    url: `${config.apiUrl}${API_ENDPOINTS.auth.refresh}`,
    hasRefreshCookieMirror: Boolean(refreshToken),
    hasBearer: Boolean(access),
  });

  try {
    const response = await apiClient.post<AuthResponse>(API_ENDPOINTS.auth.refresh, {}, { headers });
    const headerMap = serializeResponseHeaders(response.headers);
    logAuthEvent("refresh.response.headers", {
      hasRefreshHeader: Boolean(headerLookup(headerMap, "x-caretip-refresh")),
      hasSetCookie: Boolean(headerLookup(headerMap, "set-cookie")),
      hasAccessToken: Boolean(response.data?.token),
    });
    await persistRefreshFromResponse(response.headers);
    const session = await persistSession(response.data);
    logAuthEvent("refresh.endpoint.success", { hasAccessToken: Boolean(session.token) });
    return session;
  } catch (error) {
    logAuthEvent("refresh.endpoint.failed", {
      status: (error as { response?: { status?: number; data?: { message?: string } } })?.response
        ?.status,
      message:
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (error instanceof Error ? error.message : "unknown"),
      backendRoute: "/api/auth/refresh",
    });
    // Interceptor / grace path may still recover a raw access token.
    const token = await refreshAccessToken();
    if (!token) return null;
    setMemoryAccessToken(token);
    await saveAccessToken(token);
    logAuthTokenState("refresh.recovered.accessOnly", token);
    return null;
  }
}

export async function logout(): Promise<void> {
  const refreshToken = await getRefreshToken();
  try {
    await apiClient.post(
      API_ENDPOINTS.auth.logout,
      {},
      {
        headers: {
          [config.clientHeaderName]: config.clientHeader,
          ...(refreshToken ? { Cookie: buildRefreshCookieHeader(refreshToken) } : {}),
        },
      },
    );
  } catch {
    /* Always clear local session even if network fails. */
  } finally {
    setMemoryAccessToken(null);
    await clearAllSessionSecrets();
  }
}

export const authService = {
  login,
  refreshSession,
  logout,
};
