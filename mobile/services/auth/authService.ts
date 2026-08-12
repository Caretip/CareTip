import { API_ENDPOINTS } from "@/constants/endpoints";
import {
  apiClient,
  getMemoryAccessToken,
  markNewAccessSession,
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
import { normalizeInviteCode } from "@/utils/normalizeInviteCode";
import {
  headerLookup,
  logAuthEvent,
  logAuthTokenState,
  logLoginTrace,
  serializeResponseHeaders,
} from "@/utils/authDebug";
import { config } from "@/constants/config";
import type {
  AuthResponse,
  InviteValidation,
  LinkOAuthResult,
  LinkedOAuthAccountsResponse,
  MessageResponse,
  OAuthProvider,
  OAuthRequest,
  RegisterPendingResponse,
  RegisterRequest,
  SignInRequest,
  SignInResult,
  UnlinkOAuthResult,
} from "@/types/auth";
import { isMfaChallenge } from "@/types/auth";
import { normalizeApiError } from "@/types/api";

/**
 * Auth API — reuses existing backend routes only.
 * No client-side business-rule duplication.
 */

async function persistSession(data: AuthResponse): Promise<AuthResponse> {
  markNewAccessSession(data.token);
  await saveAccessToken(data.token);
  await saveUserSnapshot(data.user);
  logAuthTokenState("session.persisted", data.token);
  return data;
}

/**
 * Persist tokens after sign-in. Matches web: access JWT from sign-in is enough to enter the app.
 * Do NOT call /api/auth/refresh here — a failed optional refresh used to clear the new access
 * token and paint "Please sign in again" on the dashboard via reportGlobalError.
 */
async function finalizeAuthResponse(
  data: AuthResponse,
  context: "login" | "oauth",
  meta?: Record<string, unknown>,
): Promise<AuthResponse> {
  await persistSession(data);

  logAuthEvent(`${context}.ready.for.dashboard`, {
    hasRefreshInSecureStore: Boolean(await getRefreshToken()),
    ...meta,
  });

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
  await finalizeAuthResponse(data, "login", { requestUrl });

  logLoginTrace({
    hasAccessToken: true,
    hasRefreshHeader,
    hasSetCookie,
    refreshPersisted,
    secureStoreReadBack: Boolean(await getRefreshToken()),
    refreshEndpointSuccess: Boolean(await getRefreshToken()),
  });

  return data;
}

/**
 * Social OAuth — same contract as web `oauthAPI`:
 * POST /api/auth/oauth → store access JWT + refresh mirror.
 * Provider defaults to google for backward compatibility.
 */
export async function oauthLogin(payload: OAuthRequest): Promise<SignInResult> {
  const provider: OAuthProvider = payload.provider ?? "google";
  const requestUrl = `${config.apiUrl}${API_ENDPOINTS.auth.oauth}`;
  logAuthEvent("oauth.request", {
    method: "POST",
    url: requestUrl,
    provider,
    isLogin: payload.isLogin,
    intendedRole: payload.intendedRole,
  });

  const response = await apiClient.post<SignInResult>(API_ENDPOINTS.auth.oauth, {
    provider,
    idToken: payload.idToken,
    isLogin: payload.isLogin,
    ...(payload.intendedRole && !payload.isLogin
      ? { intendedRole: payload.intendedRole }
      : {}),
    ...(payload.name ? { name: payload.name } : {}),
    ...(payload.inviteCode ? { inviteCode: normalizeInviteCode(payload.inviteCode) } : {}),
    ...(payload.locale ? { locale: payload.locale } : {}),
    ...(payload.timeZone ? { timeZone: payload.timeZone } : {}),
  });

  await persistRefreshFromResponse(response.headers);
  const data = response.data;

  if (isMfaChallenge(data)) {
    logAuthEvent("oauth.mfa.challenge", { provider });
    return data;
  }

  if (!data || typeof data !== "object" || !("token" in data) || !data.token || !("user" in data)) {
    throw normalizeApiError(new Error("OAuth succeeded without access token."));
  }

  await finalizeAuthResponse(data, "oauth", { provider });
  return data;
}

/** GET /api/auth/oauth/accounts — linked providers for Settings. */
export async function listOAuthAccounts(): Promise<LinkedOAuthAccountsResponse> {
  const { data } = await apiClient.get<LinkedOAuthAccountsResponse>(
    API_ENDPOINTS.auth.oauthAccounts,
  );
  return data;
}

/** POST /api/auth/oauth/link — attach a provider to the current user. */
export async function linkOAuthAccount(
  provider: OAuthProvider,
  idToken: string,
): Promise<LinkOAuthResult> {
  const { data } = await apiClient.post<LinkOAuthResult>(API_ENDPOINTS.auth.oauthLink, {
    provider,
    idToken,
  });
  return data;
}

/** POST /api/auth/oauth/unlink — remove a provider without orphaning the account. */
export async function unlinkOAuthAccount(provider: OAuthProvider): Promise<UnlinkOAuthResult> {
  const { data } = await apiClient.post<UnlinkOAuthResult>(API_ENDPOINTS.auth.oauthUnlink, {
    provider,
  });
  return data;
}

export type BootstrapValidateResult =
  | { status: "authenticated"; session: AuthResponse }
  | { status: "offline" }
  | { status: "rejected" }
  | { status: "no-secrets" };

function buildRefreshHeaders(
  refreshToken: string | null,
  access: string | null,
): Record<string, string> {
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
  return headers;
}

function isServerAuthResponse(data: unknown): data is AuthResponse {
  return (
    typeof data === "object" &&
    data !== null &&
    "token" in data &&
    typeof (data as AuthResponse).token === "string" &&
    Boolean((data as AuthResponse).token) &&
    "user" in data &&
    typeof (data as AuthResponse).user?.id === "string" &&
    Boolean((data as AuthResponse).user.id)
  );
}

/**
 * POST /api/auth/refresh — server must return access token + AuthUser.
 * There is no GET /api/auth/me; refresh's AuthUser is the validated identity.
 * Never fabricates a session from a cached user snapshot.
 */
async function requestSessionRefresh(): Promise<AuthResponse | null> {
  const refreshToken = await getRefreshToken();
  const access = getMemoryAccessToken();
  if (!refreshToken && !access) return null;

  logAuthEvent("refresh.attempt", {
    url: `${config.apiUrl}${API_ENDPOINTS.auth.refresh}`,
    hasRefreshCookieMirror: Boolean(refreshToken),
    hasBearer: Boolean(access),
  });

  const response = await apiClient.post<AuthResponse>(
    API_ENDPOINTS.auth.refresh,
    {},
    { headers: buildRefreshHeaders(refreshToken, access) },
  );
  const headerMap = serializeResponseHeaders(response.headers);
  logAuthEvent("refresh.response.headers", {
    hasRefreshHeader: Boolean(headerLookup(headerMap, "x-caretip-refresh")),
    hasSetCookie: Boolean(headerLookup(headerMap, "set-cookie")),
    hasAccessToken: Boolean(response.data?.token),
    hasUser: Boolean(response.data?.user?.id),
  });
  await persistRefreshFromResponse(response.headers);
  if (!isServerAuthResponse(response.data)) {
    logAuthEvent("refresh.invalid.response");
    return null;
  }
  const session = await persistSession(response.data);
  logAuthEvent("refresh.endpoint.success", { hasAccessToken: Boolean(session.token) });
  return session;
}

/**
 * Rotates access JWT via POST /api/auth/refresh.
 * Returns null unless the backend returns a full AuthResponse (token + user).
 */
export async function refreshSession(): Promise<AuthResponse | null> {
  try {
    return await requestSessionRefresh();
  } catch (error) {
    logAuthEvent("refresh.endpoint.failed", {
      status: (error as { response?: { status?: number; data?: { message?: string } } })?.response
        ?.status,
      message:
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (error instanceof Error ? error.message : "unknown"),
      backendRoute: "/api/auth/refresh",
    });
    // Interceptor may still recover an access token for in-flight API retries.
    // Do not invent AuthUser from SecureStore snapshot — that is not server validation.
    const token = await refreshAccessToken();
    if (!token) return null;
    logAuthTokenState("refresh.recovered.accessOnly", token);
    return null;
  }
}

/**
 * Phase 2.4 — cold-start session validation.
 * Authenticated navigation is allowed only after a successful refresh AuthResponse.
 */
export async function validateBootstrapSession(): Promise<BootstrapValidateResult> {
  const refreshToken = await getRefreshToken();
  const access = getMemoryAccessToken();
  if (!refreshToken && !access) {
    return { status: "no-secrets" };
  }

  const { isOnline } = await import("@/utils/network");
  if (!(await isOnline())) {
    return { status: "offline" };
  }

  try {
    const session = await requestSessionRefresh();
    if (!session) return { status: "rejected" };
    return { status: "authenticated", session };
  } catch (error) {
    const normalized = normalizeApiError(error);
    logAuthEvent("bootstrap.validate.failed", {
      status: normalized.status,
      isNetworkError: normalized.isNetworkError,
      isTimeout: normalized.isTimeout,
      message: normalized.message,
    });
    if (normalized.isNetworkError || normalized.isTimeout) {
      return { status: "offline" };
    }
    return { status: "rejected" };
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

/** Email registration — same contract as web `registerAPI`. */
export async function register(payload: RegisterRequest): Promise<RegisterPendingResponse> {
  const body: RegisterRequest = {
    ...payload,
    email: payload.email.trim(),
    ...(payload.inviteCode
      ? { inviteCode: normalizeInviteCode(payload.inviteCode) }
      : {}),
  };
  const response = await apiClient.post<RegisterPendingResponse>(API_ENDPOINTS.auth.register, body);
  const data = response.data;
  return {
    requiresEmailVerification: true,
    email: data.email ?? data.user?.email ?? payload.email,
    role: data.role ?? payload.role,
    user: data.user,
  };
}

export async function requestPasswordReset(
  email: string,
  locale?: RegisterRequest["locale"],
): Promise<MessageResponse> {
  const { data } = await apiClient.post<MessageResponse>(API_ENDPOINTS.auth.forgotPassword, {
    email: email.trim(),
    ...(locale ? { locale } : {}),
  });
  return data;
}

export async function resetPasswordWithToken(
  token: string,
  password: string,
): Promise<MessageResponse> {
  const { data } = await apiClient.post<MessageResponse>(API_ENDPOINTS.auth.resetPassword, {
    token: token.trim(),
    password,
  });
  return data;
}

export async function verifyEmailWithToken(token: string): Promise<MessageResponse> {
  const { data } = await apiClient.get<MessageResponse>(API_ENDPOINTS.auth.verifyEmail, {
    params: { token: token.trim() },
  });
  return data;
}

export async function resendVerificationEmail(
  email: string,
  password: string,
  locale?: RegisterRequest["locale"],
): Promise<MessageResponse> {
  const { data } = await apiClient.post<MessageResponse>(API_ENDPOINTS.auth.resendVerification, {
    email: email.trim(),
    password,
    ...(locale ? { locale } : {}),
  });
  return data;
}

export async function resendVerificationEmailSession(
  locale?: RegisterRequest["locale"],
): Promise<MessageResponse> {
  const { data } = await apiClient.post<MessageResponse>(
    API_ENDPOINTS.auth.resendVerificationSession,
    locale ? { locale } : {},
  );
  return data;
}

export async function patchMyOnboardingStatus(
  hasCompletedOnboarding: boolean,
): Promise<AuthResponse> {
  const response = await apiClient.patch<AuthResponse>(API_ENDPOINTS.auth.patchMe, {
    hasCompletedOnboarding,
  });
  await persistRefreshFromResponse(response.headers);
  return persistSession(response.data);
}

export async function validateInviteCode(code: string): Promise<InviteValidation> {
  const normalized = normalizeInviteCode(code);
  const { data } = await apiClient.get<InviteValidation>(API_ENDPOINTS.business.inviteValidate, {
    params: { code: normalized },
  });
  return data;
}

export const authService = {
  login,
  oauthLogin,
  listOAuthAccounts,
  linkOAuthAccount,
  unlinkOAuthAccount,
  refreshSession,
  validateBootstrapSession,
  logout,
  register,
  requestPasswordReset,
  resetPasswordWithToken,
  verifyEmailWithToken,
  resendVerificationEmail,
  resendVerificationEmailSession,
  patchMyOnboardingStatus,
  validateInviteCode,
};
