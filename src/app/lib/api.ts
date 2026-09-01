/**
 * API client for Caretip backend.
 * Base URL: VITE_API_URL (e.g. http://localhost:3001)
 * All errors are translated to user-friendly messages before being thrown.
 */

import {
  toUserFriendlyMessage,
  fallbackMessageForHttpStatus,
  SERVICE_UNAVAILABLE_CLIENT_MESSAGE,
  API_WAKEUP_NETWORK_MESSAGE,
  isAbortError,
  isApiConnectivityError,
} from "./errorMessages";
import {
  ApiRequestError,
  EMAIL_NOT_VERIFIED_CODE,
  GOOGLE_ACCOUNT_NOT_REGISTERED_CODE,
  PENDING_VERIFICATION_CODE,
  SUBSCRIPTION_REQUIRED_CODE,
} from "./apiError";
import { resolveApiBaseUrl } from "./apiOrigin";
import { logClientError } from "./clientLog";
import type { OAuthProviderId } from "./oauthProviderIds";
import { captureClientException } from "./sentry";
import { validateImageFileForUpload } from "./imageClientUpload";
import {
  primeSubscriptionEntitlementsFromSession,
  primeSubscriptionTierFromSession,
} from "./subscriptionSessionCache";
import { resolveSubscriptionTier } from "./subscriptionCapabilities";
import { authDebug } from "./authDebugLog";
import {
  devTrackDeduped,
  devTrackEnd,
  devTrackStart,
  resolveDashboardApiDebugTarget,
} from "./dashboardDevDebug";
import {
  getAuthSessionFlags,
  isSessionBootstrapInProgress,
  whenSessionBootstrapSettled,
} from "./authSessionBootstrap";
import { logDashboardTenantRequest } from "./dashboardTenantLog";
import { clearClientSessionHint } from "./authSessionHint";
import { notifyAuthStorageSync } from "./authStorageSync";
import {
  clearMemoryAccessToken,
  getMemoryAccessToken,
  migrateLegacyAccessTokenFromStorage,
  setMemoryAccessToken,
} from "./accessTokenStore";
import { guestQrScanHeaders, getOrCreateQrScanSessionId } from "./qrScanSession";

const AUTH_REFRESH_PATHNAME = "/api/auth/refresh";

export { migrateLegacyAccessTokenFromStorage } from "./accessTokenStore";

/** Set on explicit logout; blocks silent refresh until the next successful sign-in. */
export const SESSION_REVOKED_STORAGE_KEY = "caretip_session_revoked";

export function isClientSessionRevoked(): boolean {
  try {
    return localStorage.getItem(SESSION_REVOKED_STORAGE_KEY) != null;
  } catch {
    return false;
  }
}

export function markClientSessionRevoked(): void {
  try {
    localStorage.setItem(SESSION_REVOKED_STORAGE_KEY, String(Date.now()));
  } catch {
    // ignore
  }
}

/** IANA timezone from the browser (e.g. Europe/Berlin) for login security emails. */
export function getBrowserTimeZone(): string | undefined {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof tz === "string" && tz.trim() ? tz.trim() : undefined;
  } catch {
    return undefined;
  }
}

export function clearClientSessionRevoked(): void {
  try {
    localStorage.removeItem(SESSION_REVOKED_STORAGE_KEY);
  } catch {
    // ignore
  }
}

const LOGOUT_PENDING_STORAGE_KEY = "caretip_logout_pending";

/** True while explicit sign-out is in flight (route loaders show signing-out copy). */
export function isLogoutPending(): boolean {
  try {
    return sessionStorage.getItem(LOGOUT_PENDING_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function markLogoutPending(): void {
  try {
    sessionStorage.setItem(LOGOUT_PENDING_STORAGE_KEY, "1");
  } catch {
    // ignore
  }
}

export function clearLogoutPending(): void {
  try {
    sessionStorage.removeItem(LOGOUT_PENDING_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function cancelPendingSessionRefresh(): void {
  refreshSingleton = null;
}

function isAuthRefreshRequestUrl(url: string): boolean {
  return requestUrlPathname(url) === AUTH_REFRESH_PATHNAME;
}

type RefreshSessionResult =
  | { ok: true; data: AuthResponse }
  | { ok: false; status: number; shouldClearSession: boolean };

/** Single-flight refresh: shared by `refreshSessionAPI` and 401 recovery (`refreshAccessToken`). */
let refreshSingleton: Promise<RefreshSessionResult> | null = null;
let refreshFailureCooldownUntil = 0;
const REFRESH_FAILURE_COOLDOWN_MS = 15_000;

/** Validates `{ token, user }` auth payloads from login, OAuth, refresh, and MFA completion. */
export function parseAuthResponsePayload(data: unknown): AuthResponse | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.token !== "string" || !d.token.trim()) return null;
  const u = d.user;
  if (!u || typeof u !== "object") return null;
  const ur = u as Record<string, unknown>;
  if (typeof ur.id !== "string" || typeof ur.email !== "string" || typeof ur.role !== "string") return null;
  return data as AuthResponse;
}

function parseAuthRefreshPayload(data: unknown): AuthResponse | null {
  return parseAuthResponsePayload(data);
}

/**
 * POST /api/auth/refresh with bounded retries.
 * UX goal: keep startup fast — at most one retry for transient failures.
 * Stops after auth rejection (401/403) immediately.
 * After final failure: caller should clear session (handled in {@link ensureRefreshedSession}).
 */
async function runRefreshAuthWithRetries(): Promise<RefreshSessionResult> {
  if (isClientSessionRevoked()) {
    clearAuthStorage();
    return { ok: false, shouldClearSession: true, status: 401 };
  }

  if (Date.now() < refreshFailureCooldownUntil) {
    return { ok: false, shouldClearSession: false, status: 503 };
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      const backoffMs = resolveApiBaseUrl() ? 2000 : 500;
      await new Promise((r) => setTimeout(r, backoffMs));
    }

    let res: Response;
    try {
      const refreshHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        "X-CareTip-Client": "1",
      };
      res = await fetchWithNetworkRetry(apiPath(AUTH_REFRESH_PATHNAME), {
        method: "POST",
        headers: refreshHeaders,
        body: EMPTY_JSON_BODY,
        credentials: "include",
      });
    } catch (err) {
      logClientError("api.runRefreshAuthWithRetries.fetch", err, { attempt });
      if (attempt === 1) {
        return { ok: false, shouldClearSession: false, status: 0 };
      }
      continue;
    }

    if (res.ok) {
      const raw = await res.json().catch(() => null);
      const parsed = parseAuthRefreshPayload(raw);
      if (parsed) {
        setToken(parsed.token);
        refreshFailureCooldownUntil = 0;
        return { ok: true, data: parsed };
      }
      return { ok: false, shouldClearSession: true, status: res.status };
    }

    if (res.status === 401 || res.status === 403) {
      return { ok: false, shouldClearSession: true, status: res.status };
    }

    const transient =
      res.status === 503 ||
      res.status === 502 ||
      res.status === 504 ||
      res.status === 429 ||
      res.status >= 500;

    if (transient) {
      if (attempt < 1) continue;
      refreshFailureCooldownUntil = Date.now() + REFRESH_FAILURE_COOLDOWN_MS;
      return { ok: false, shouldClearSession: false, status: res.status };
    }

    return { ok: false, shouldClearSession: true, status: res.status };
  }

  refreshFailureCooldownUntil = Date.now() + REFRESH_FAILURE_COOLDOWN_MS;
  return { ok: false, shouldClearSession: true, status: 0 };
}

function mayClearClientAuthStorage(): boolean {
  const { authHydrated, sessionValidated } = getAuthSessionFlags();
  return authHydrated && sessionValidated;
}

async function ensureRefreshedSession(): Promise<RefreshSessionResult> {
  if (refreshSingleton) {
    devTrackDeduped("auth:refresh", "auth:refresh", { inflight: true });
    return refreshSingleton;
  }
  devTrackStart("auth:refresh", "auth:refresh");
  refreshSingleton = (async (): Promise<RefreshSessionResult> => {
    try {
      const out = await runRefreshAuthWithRetries();
      if (!out.ok && out.shouldClearSession && mayClearClientAuthStorage()) {
        clearAuthStorage();
      }
      devTrackEnd("auth:refresh", "auth:refresh", "completed");
      return out;
    } catch (err) {
      devTrackEnd("auth:refresh", "auth:refresh", "error", err);
      throw err;
    } finally {
      refreshSingleton = null;
    }
  })();
  return refreshSingleton;
}

async function refreshAccessToken(): Promise<{ token: string | null; shouldClearAccessToken: boolean }> {
  const r = await ensureRefreshedSession();
  if (r.ok) return { token: r.data.token, shouldClearAccessToken: false };
  return { token: null, shouldClearAccessToken: r.shouldClearSession };
}

/** Absolute path (starts with /) or full URL; honors Vite proxy when base is empty. */
function apiPath(path: string): string {
  const base = resolveApiBaseUrl();
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const p = path.startsWith("/") ? path : `/${path}`;
  return base ? `${base}${p}` : p;
}

function getToken(): string | null {
  return getMemoryAccessToken();
}

export function hasClientAccessToken(): boolean {
  const t = getToken();
  return typeof t === "string" && t.trim().length > 0;
}

function setToken(token: string | null): void {
  setMemoryAccessToken(token);
}

/** Clears in-memory access token + user snapshot (keeps {@link SESSION_REVOKED_STORAGE_KEY} when set). */
export function clearClientAuthStorage(options?: { notifySync?: boolean }): void {
  cancelPendingSessionRefresh();
  refreshFailureCooldownUntil = 0;
  clearEmployeeProfileClientCache();
  try {
    clearMemoryAccessToken();
    localStorage.removeItem("caretip_token");
    localStorage.removeItem("caretip_user");
    clearClientSessionHint();
    if (options?.notifySync !== false) {
      notifyAuthStorageSync();
    }
  } catch {
    // ignore
  }
}

function clearAuthStorage(): void {
  clearClientAuthStorage();
}

/** Pathname for CareTip API URLs whether `url` is relative or absolute (e.g. `VITE_API_URL` + `/api/...`). */
function requestUrlPathname(url: string): string {
  try {
    const base =
      typeof window !== "undefined" && window.location?.origin ? window.location.origin : "http://localhost";
    return new URL(url, base).pathname;
  } catch {
    if (url.startsWith("/")) {
      const q = url.indexOf("?");
      const path = q === -1 ? url : url.slice(0, q);
      const h = path.indexOf("#");
      return h === -1 ? path : path.slice(0, h);
    }
    return "";
  }
}

function requestUsesCaretipProtectedApi(url: string): boolean {
  const p = requestUrlPathname(url);
  return p.startsWith("/api/") || p.startsWith("/uploads/");
}

/**
 * Merge the latest access token from storage into `init` immediately before `fetch`.
 * Overwrites any stale `Authorization` header from a captured `RequestInit`.
 */
function attachLatestBearer(init?: RequestInit): RequestInit {
  try {
    // Diagnostic: never run in production builds (avoids any opt-in debug output from shipping).
    if (
      import.meta.env.DEV &&
      typeof localStorage !== "undefined" &&
      localStorage.getItem("caretip_auth_debug") === "1"
    ) {
      const t = getToken();
      console.log("Auth token:", t && t.trim() ? "present (memory)" : "absent");
    }
  } catch {
    // ignore
  }

  const next: RequestInit = { ...(init ?? {}) };
  const token = getToken()?.trim();
  const headers = new Headers();
  const h = next.headers;
  if (h instanceof Headers) {
    h.forEach((v, k) => {
      if (k.toLowerCase() !== "authorization") headers.set(k, v);
    });
  } else if (Array.isArray(h)) {
    for (const [k, v] of h) {
      if (String(k).toLowerCase() !== "authorization") headers.set(k, v);
    }
  } else if (h && typeof h === "object") {
    for (const [k, v] of Object.entries(h as Record<string, string>)) {
      if (k.toLowerCase() !== "authorization" && v != null) headers.set(k, String(v));
    }
  }
  if (token) headers.set("Authorization", `Bearer ${token}`);
  next.headers = headers;
  return next;
}

/** Valid empty JSON object for POST routes that have no fields (refresh, logout, etc.). */
const EMPTY_JSON_BODY = "{}";

function getHeaders(): HeadersInit {
  const headers: HeadersInit = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

/** Always produces valid JSON; never double-encodes an already-serialized JSON string. */
function toJsonRequestBody(data: unknown): string {
  if (typeof data === "string") {
    const trimmed = data.trim();
    if (trimmed.length > 0) {
      try {
        JSON.parse(trimmed);
        return trimmed;
      } catch {
        // not JSON text — stringify below
      }
    }
  }
  return JSON.stringify(data);
}

/** Bearer only — use with FormData (do not set Content-Type). */
function getAuthHeadersOnly(): HeadersInit {
  const headers: HeadersInit = {};
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

async function handleRes<T>(res: Response, opts?: { silent?: boolean }): Promise<T> {
  const ct = res.headers.get("content-type") ?? "";
  let data: unknown = {};
  if (ct.includes("application/json")) {
    data = await res.json().catch(() => ({}));
  } else {
    const text = await res.text().catch(() => "");
    data = text.trim() ? { message: text.trim().slice(0, 300) } : {};
  }
  if (!res.ok) {
    const refreshPath = typeof res.url === "string" && res.url.includes(AUTH_REFRESH_PATHNAME);
    const body = data as { message?: string; code?: string; canResend?: boolean };
    const isExpectedPendingVerification =
      res.status === 403 &&
      (body.code === PENDING_VERIFICATION_CODE ||
        body.message?.toLowerCase().includes("pending verification"));
    const isExpectedSubscriptionRequired =
      res.status === 403 && body.code === SUBSCRIPTION_REQUIRED_CODE;
    if (
      !opts?.silent &&
      !(refreshPath && res.status >= 500) &&
      !isExpectedPendingVerification &&
      !isExpectedSubscriptionRequired
    ) {
      const apiErr = new Error(`HTTP ${res.status}`);
      logClientError("api.handleRes", apiErr, {
        status: res.status,
        url: res.url,
        body: data,
      });
      if (res.status >= 500) {
        captureClientException(apiErr, {
          scope: "api.handleRes",
          status: res.status,
          url: res.url,
        });
      }
    }
    const bodyMsg = body.message?.trim();
    const fromStatus = fallbackMessageForHttpStatus(res.status);
    const statusText = res.statusText?.trim();
    const base =
      bodyMsg ||
      fromStatus ||
      (statusText && statusText.length > 0 && statusText !== "Unknown" ? statusText : "") ||
      `Request failed (${res.status})`;
    if (body.code === EMAIL_NOT_VERIFIED_CODE) {
      throw new ApiRequestError(base, res.status, body.code, body.canResend === true);
    }
    if (body.code === GOOGLE_ACCOUNT_NOT_REGISTERED_CODE) {
      throw new ApiRequestError(base, res.status, body.code);
    }
    if (body.code === SUBSCRIPTION_REQUIRED_CODE) {
      throw new ApiRequestError(base, res.status, body.code);
    }
    if (body.code === PENDING_VERIFICATION_CODE) {
      throw new ApiRequestError(base, res.status, body.code);
    }
    throw new ApiRequestError(base, res.status, body.code, body.canResend === true);
  }
  return data as T;
}

function apiConfigHintForFailedFetch(url: string): string {
  if (!url.startsWith("/api")) return "";
  if (import.meta.env.DEV) {
    return " In local dev, relative /api URLs are proxied by Vite to the backend (see vite.config.ts). Start the API on port 3001 (e.g. from the backend folder: npm run dev). If .env sets VITE_API_URL, it must be a reachable http(s) URL or omit it to use the proxy.";
  }
  return " For this deployed build, set VITE_API_URL in your host (e.g. Netlify: Site configuration → Environment variables) to your backend origin, e.g. https://your-api.onrender.com. Then trigger a new deploy.";
}

const NETWORK_RETRY_DELAY_MS = 2500;

function isCrossOriginApi(): boolean {
  return Boolean(resolveApiBaseUrl());
}

function abortableDelay(ms: number, signal?: AbortSignal | null): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (!signal) return;
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function isNetworkFetchFailure(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  if (err instanceof Error) {
    return /failed to fetch|networkerror|load failed|network request failed|the network connection was lost/i.test(
      err.message,
    );
  }
  return false;
}

type CaretipRequestInit = RequestInit & {
  __caretipRetried?: boolean;
  __caretipDelayedRetried?: boolean;
  __caretipNetworkRetried?: boolean;
  caretipSilentErrors?: boolean;
};

/** One delayed retry for cross-origin /api calls when the host is cold-starting (e.g. Render free tier). */
async function fetchWithNetworkRetry(url: string, init?: RequestInit): Promise<Response> {
  const flags = init as CaretipRequestInit | undefined;
  try {
    return await fetch(url, init);
  } catch (err) {
    if (isAbortError(err)) throw err;
    if (flags?.__caretipNetworkRetried || !isCrossOriginApi() || !isNetworkFetchFailure(err)) {
      throw err;
    }
    const pathname = requestUrlPathname(url);
    if (!pathname.startsWith("/api/")) throw err;

    await abortableDelay(NETWORK_RETRY_DELAY_MS, init?.signal ?? undefined);
    const retried: CaretipRequestInit = { ...(init ?? {}), __caretipNetworkRetried: true };
    try {
      return await fetch(url, retried);
    } catch (retryErr) {
      if (isNetworkFetchFailure(retryErr)) {
        throw new Error(API_WAKEUP_NETWORK_MESSAGE);
      }
      throw retryErr;
    }
  }
}

export { wakeRemoteApi } from "./wakeRemoteApi";

/** Wraps fetch + handleRes and translates network/API errors to user-friendly messages */
async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  const initFlags = init as CaretipRequestInit | undefined;
  const devDebug = resolveDashboardApiDebugTarget(url);

  if (
    requestUsesCaretipProtectedApi(url) &&
    !isAuthRefreshRequestUrl(url) &&
    isSessionBootstrapInProgress()
  ) {
    await whenSessionBootstrapSettled();
  }

  try {
    if (devDebug) devTrackStart(devDebug.group, devDebug.key, devDebug.meta);
    res = await fetchWithNetworkRetry(url, attachLatestBearer(init));
  } catch (err) {
    if (isAbortError(err)) {
      if (devDebug) devTrackEnd(devDebug.group, devDebug.key, "aborted", err);
      throw err;
    }
    if (isApiConnectivityError(err)) {
      authDebug("api_request_network", { path: requestUrlPathname(url) });
    } else if (!initFlags?.caretipSilentErrors) {
      logClientError("api.apiRequest", err, { url });
    }
    if (devDebug) devTrackEnd(devDebug.group, devDebug.key, "error", err);
    const baseMsg = toUserFriendlyMessage(err);
    const devHint = import.meta.env.DEV ? apiConfigHintForFailedFetch(url) : "";
    throw new Error(baseMsg + devHint);
  }

  if (res.status === 401) {
    const isCaretipApi = requestUsesCaretipProtectedApi(url);
    const isAuthRefresh = isAuthRefreshRequestUrl(url);
    const tokenAtStart = getToken();
    const tokenIsSet = typeof tokenAtStart === "string" && tokenAtStart.trim().length > 0;
    /** HttpOnly refresh cookie can restore a session even when the access token is missing from storage. */
    const canAttemptRefresh = isCaretipApi && !isAuthRefresh;
    const alreadyRetried = initFlags?.__caretipRetried === true;
    let refreshDeemedInvalid = false;

    authDebug("apiRequest 401", {
      url,
      pathname: requestUrlPathname(url),
      isCaretipApi,
      hasToken: tokenIsSet,
      isAuthRefresh,
    });

    if (isAuthRefresh && isCaretipApi) {
      refreshDeemedInvalid = true;
      if (mayClearClientAuthStorage()) clearAuthStorage();
    } else if (canAttemptRefresh && !alreadyRetried && Date.now() >= refreshFailureCooldownUntil) {
      const { token: nextToken, shouldClearAccessToken } = await refreshAccessToken();
      if (shouldClearAccessToken) refreshDeemedInvalid = true;
      if (nextToken) {
        const retriedInit: CaretipRequestInit = { ...(init ?? {}), __caretipRetried: true };
        res = await fetchWithNetworkRetry(url, attachLatestBearer(retriedInit));
      } else if (shouldClearAccessToken && mayClearClientAuthStorage()) {
        clearAuthStorage();
      }
    }

    // If we're still unauthorized, do a single short-delay retry before clearing auth.
    // This avoids \"logout on first login\" caused by timing/race conditions around initial auth state.
    if (!isAuthRefresh && canAttemptRefresh && res.status === 401) {
      const alreadyDelayedRetry = initFlags?.__caretipDelayedRetried === true;
      if (!alreadyDelayedRetry) {
        await abortableDelay(250, init?.signal ?? undefined);
        const delayedInit: CaretipRequestInit = { ...(init ?? {}), __caretipDelayedRetried: true };
        res = await fetchWithNetworkRetry(url, attachLatestBearer(delayedInit));
      }
    }

    // Clear session only when the refresh flow marked tokens invalid, or no token remains.
    // Avoids logging users out on a stray 401 while a token is still present (e.g. permission mismatch).
    if (res.status === 401 && isCaretipApi && mayClearClientAuthStorage()) {
      const t = getToken()?.trim();
      if (!t || refreshDeemedInvalid) {
        clearAuthStorage();
      }
    }
  }

  try {
    const out = await handleRes<T>(res, { silent: initFlags?.caretipSilentErrors === true });
    if (devDebug) devTrackEnd(devDebug.group, devDebug.key, "completed");
    return out;
  } catch (err) {
    if (devDebug) devTrackEnd(devDebug.group, devDebug.key, "error", err);
    throw err;
  }
}

/** Fetch a protected file (PDF/image) with Bearer auth and return an object URL. */
export async function fetchAuthedObjectUrl(inputUrl: string): Promise<string> {
  const trimmed = inputUrl.trim();
  if (trimmed.startsWith("kyc-object:") || trimmed.startsWith("kyc-disk:")) {
    const data = await apiRequest<{ url: string; mode?: string }>(
      apiPath(`/api/media/secure-access?ref=${encodeURIComponent(trimmed)}`),
    );
    if (data.mode === "signed") {
      return data.url;
    }
    return fetchAuthedObjectUrl(data.url);
  }

  const url = apiPath(inputUrl);
  if (requestUsesCaretipProtectedApi(url) && isSessionBootstrapInProgress()) {
    await whenSessionBootstrapSettled();
  }
  const baseGet: RequestInit = { method: "GET", credentials: "include" };
  let res = await fetch(url, attachLatestBearer(baseGet));
  let refreshDeemedInvalid = false;

  if (res.status === 401 && requestUsesCaretipProtectedApi(url)) {
    const { token: nextToken, shouldClearAccessToken } = await refreshAccessToken();
    if (shouldClearAccessToken) refreshDeemedInvalid = true;
    if (nextToken) {
      res = await fetch(url, attachLatestBearer(baseGet));
    } else if (shouldClearAccessToken && mayClearClientAuthStorage()) {
      clearAuthStorage();
    }
  }

  if (res.status === 401 && requestUsesCaretipProtectedApi(url) && mayClearClientAuthStorage()) {
    const t = getToken()?.trim();
    if (!t || refreshDeemedInvalid) {
      clearAuthStorage();
    }
  }

  if (!res.ok) {
    // Reuse error formatting for consistent messages.
    await handleRes(res);
    throw new Error("Failed to fetch file");
  }

  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

// Auth
export type OnboardingVerificationStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "rejected";

export type KycVerificationStatus =
  | "not_started"
  | "awaiting_upload"
  | "pending_review"
  | "verified"
  | "rejected";

export interface RegisterPendingResponse {
  requiresEmailVerification: true;
  user: AuthResponse["user"];
}

export interface AuthResponse {
  token: string;
  user: {
    id: string;
    email: string;
    role: string;
    name: string;
    emailVerified?: boolean;
    hasCompletedOnboarding?: boolean;
    onboardingStep?: number;
    businessId?: string;
    employeeId?: string;
    avatar?: string | null;
    impersonation?: boolean;
    impersonatedBy?: string;
    /** Legacy KYC mirror column; prefer `kycVerificationStatus`. */
    businessVerificationStatus?: "pending" | "verified" | "rejected";
    onboardingVerificationStatus?: OnboardingVerificationStatus;
    kycVerificationStatus?: KycVerificationStatus;
    /** `en` | `de` — UI + transactional email language. */
    preferredLocale?: string | null;
  };
}

export interface MfaLoginChallenge {
  mfaRequired: true;
  mfaSetupRequired: boolean;
  pendingMfaToken: string;
}

export type LoginApiResult = AuthResponse | MfaLoginChallenge;

export function isMfaLoginChallenge(data: unknown): data is MfaLoginChallenge {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return d.mfaRequired === true && typeof d.pendingMfaToken === "string";
}

export async function registerAPI(payload: {
  email: string;
  password: string;
  name?: string;
  role: "business" | "employee";
  inviteCode?: string;
  /** Sent as `locale` for email + `users.preferred_locale` on sign-up. */
  locale?: "en" | "de";
}): Promise<RegisterPendingResponse> {
  return apiRequest<RegisterPendingResponse>(apiPath("/api/auth/register"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: toJsonRequestBody(payload),
    credentials: "include",
  });
}

/** Backend Prisma enum; API sign-in rejects frontend labels (business / employee / platform_admin). */
function toBackendIntendedRole(
  intendedRole: "business" | "employee" | "platform_admin",
): "MANAGER" | "EMPLOYEE" | "SUPER_ADMIN" {
  switch (intendedRole) {
    case "business":
      return "MANAGER";
    case "employee":
      return "EMPLOYEE";
    case "platform_admin":
      return "SUPER_ADMIN";
    default:
      return "EMPLOYEE";
  }
}

export async function loginAPI(
  email: string,
  password: string,
  locale?: "en" | "de"
): Promise<LoginApiResult> {
  const timeZone = getBrowserTimeZone();
  return apiRequest<LoginApiResult>(apiPath("/api/auth/signin"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: toJsonRequestBody({
      email,
      password,
      ...(locale ? { locale } : {}),
      ...(timeZone ? { timeZone } : {}),
    }),
    credentials: "include",
  });
}

export async function loginMfaSetupAPI(pendingMfaToken: string): Promise<{ otpauthUrl: string; qrDataUrl: string }> {
  return apiRequest(apiPath("/api/auth/login/mfa/setup"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: toJsonRequestBody({ pendingMfaToken }),
    credentials: "include",
  });
}

export async function loginMfaEnableAPI(
  pendingMfaToken: string,
  code: string,
): Promise<AuthResponse> {
  return apiRequest<AuthResponse>(apiPath("/api/auth/login/mfa/enable"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: toJsonRequestBody({ pendingMfaToken, code }),
    credentials: "include",
  });
}

export async function loginMfaVerifyAPI(
  pendingMfaToken: string,
  code: string,
): Promise<AuthResponse> {
  return apiRequest<AuthResponse>(apiPath("/api/auth/login/mfa/verify"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: toJsonRequestBody({ pendingMfaToken, code }),
    credentials: "include",
  });
}

export async function logoutAPI(): Promise<void> {
  await logoutAPIWithTimeout();
}

export type LogoutAPIResult = {
  ok: boolean;
  timedOut: boolean;
  durationMs: number;
  apiStartMs: number;
};

const LOGOUT_API_TIMEOUT_MS = 8_000;

/**
 * POST /api/auth/logout with HttpOnly cookie + optional Bearer token.
 * Non-blocking for UX — call after local cleanup; times out after 8s and logs failure.
 * Server-side refresh invalidation / audit still attempted when the request completes in time.
 */
export async function logoutAPIWithTimeout(options?: {
  capturedToken?: string | null;
  timeoutMs?: number;
  /** Monotonic time at logout click — used for dev timeline logs only. */
  clickStartedAt?: number;
}): Promise<LogoutAPIResult> {
  const timeoutMs = options?.timeoutMs ?? LOGOUT_API_TIMEOUT_MS;
  const apiStartMs = performance.now();
  cancelPendingSessionRefresh();

  const token = options?.capturedToken?.trim() || getToken()?.trim();

  let timedOut = false;
  authDebug("logout_api_start", {
    timeoutMs,
    hasBearer: Boolean(token),
    msSinceClick:
      options?.clickStartedAt != null ? Math.round(apiStartMs - options.clickStartedAt) : undefined,
  });

  try {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const logoutHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        "X-CareTip-Client": "1",
      };
      if (token) {
        logoutHeaders.Authorization = `Bearer ${token.trim()}`;
      }

      const response = await fetch(apiPath("/api/auth/logout"), {
        method: "POST",
        headers: logoutHeaders,
        body: EMPTY_JSON_BODY,
        credentials: "include",
        signal: controller.signal,
      });
      if (!response.ok) {
        logClientError("api.logoutAPI.status", new Error(`logout HTTP ${response.status}`));
      }
    } finally {
      window.clearTimeout(timeoutId);
    }
  } catch (err) {
    if (timedOut) {
      logClientError(
        "api.logoutAPI.timeout",
        new Error(`logout API exceeded ${timeoutMs}ms — continuing with local session cleared`),
      );
    } else {
      logClientError("api.logoutAPI", err);
    }
  } finally {
    clearClientAuthStorage();
  }

  const durationMs = performance.now() - apiStartMs;
  const ok = !timedOut;
  authDebug("logout_api_complete", {
    ok,
    timedOut,
    durationMs: Math.round(durationMs),
    msSinceClick:
      options?.clickStartedAt != null
        ? Math.round(performance.now() - options.clickStartedAt)
        : undefined,
  });

  return { ok, timedOut, durationMs, apiStartMs };
}

export async function resendVerificationEmailAPI(
  email: string,
  password: string,
  locale?: "en" | "de"
): Promise<{ ok: boolean; message: string }> {
  return apiRequest<{ ok: boolean; message: string }>(apiPath("/api/auth/resend-verification-email"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, ...(locale ? { locale } : {}) }),
    credentials: "include",
  });
}

/** While logged in with an unverified account (e.g. check-email page after signup). Uses Bearer token. */
export async function resendVerificationEmailSessionAPI(
  locale?: "en" | "de"
): Promise<{ ok: boolean; message: string }> {
  return apiRequest<{ ok: boolean; message: string }>(apiPath("/api/auth/resend-verification-email/session"), {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(locale ? { locale } : {}),
    credentials: "include",
  });
}

export {
  ApiRequestError,
  EMAIL_NOT_VERIFIED_CODE,
  GOOGLE_ACCOUNT_NOT_REGISTERED_CODE,
  OAUTH_ACCOUNT_NOT_REGISTERED_CODE,
  OAUTH_LINKING_REQUIRED_CODE,
  OAUTH_SIGN_IN_FAILED_CODE,
  OAUTH_EMAIL_REQUIRED_CODE,
  OAUTH_TOKEN_VERIFICATION_FAILED_CODE,
  isApiRequestError,
} from "./apiError";

export async function requestPasswordReset(
  email: string,
  locale?: "en" | "de"
): Promise<{ ok: boolean; message: string }> {
  return apiRequest<{ ok: boolean; message: string }>(apiPath("/api/auth/forgot-password"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, ...(locale ? { locale } : {}) }),
    credentials: "include",
  });
}

export async function resetPasswordWithToken(
  token: string,
  password: string
): Promise<{ ok: boolean; message: string }> {
  return apiRequest<{ ok: boolean; message: string }>(apiPath("/api/auth/reset-password"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, password }),
    credentials: "include",
  });
}

export async function activateEmployeeWithToken(
  token: string,
  password: string
): Promise<AuthResponse> {
  return apiRequest<AuthResponse>(apiPath("/api/auth/activate-employee"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, password }),
    credentials: "include",
  });
}

export async function getActivateEmployeeBranding(
  token: string
): Promise<{ businessName: string; businessLogo: string | null }> {
  const t = String(token ?? "").trim();
  if (!t) throw new Error("Activation token is required");
  return apiRequest<{ businessName: string; businessLogo: string | null }>(
    apiPath(`/api/auth/activate-employee-branding?token=${encodeURIComponent(t)}`),
    { method: "GET" }
  );
}

/** Deduplicate in-flight verification for the same token (React StrictMode / effect retries / double navigation). */
const verifyEmailInFlight = new Map<string, Promise<{ ok: true; message: string }>>();

export async function verifyEmailWithToken(token: string): Promise<{ ok: true; message: string }> {
  const key = String(token ?? "").trim();
  if (!key) {
    return Promise.reject(new Error("Verification link is invalid or has expired."));
  }
  let p = verifyEmailInFlight.get(key);
  if (!p) {
    const sp = new URLSearchParams({ token: key });
    p = apiRequest<{ ok: true; message: string }>(apiPath(`/api/auth/verify-email?${sp.toString()}`), {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
    }).finally(() => {
      verifyEmailInFlight.delete(key);
    });
    verifyEmailInFlight.set(key, p);
  }
  return p;
}

export type { OAuthProviderId };

export async function oauthAPI(payload: {
  provider: OAuthProviderId;
  idToken: string;
  isLogin: boolean;
  /** Sign-up only; omitted on login (role from database). */
  intendedRole?: "business" | "employee";
  name?: string;
  businessName?: string;
  businessType?: string;
  location?: string;
  inviteCode?: string;
  locale?: "en" | "de";
}): Promise<AuthResponse> {
  const timeZone = getBrowserTimeZone();
  const raw = await apiRequest<unknown>(apiPath("/api/auth/oauth"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: toJsonRequestBody({
      provider: payload.provider,
      idToken: payload.idToken,
      isLogin: payload.isLogin,
      ...(payload.intendedRole
        ? { intendedRole: toBackendIntendedRole(payload.intendedRole) }
        : {}),
      ...(payload.name ? { name: payload.name } : {}),
      ...(payload.businessName ? { businessName: payload.businessName } : {}),
      ...(payload.businessType ? { businessType: payload.businessType } : {}),
      ...(payload.location ? { location: payload.location } : {}),
      ...(payload.inviteCode ? { inviteCode: payload.inviteCode } : {}),
      ...(payload.locale ? { locale: payload.locale } : {}),
      ...(timeZone ? { timeZone } : {}),
    }),
    credentials: "include",
  });
  const parsed = parseAuthResponsePayload(raw);
  if (!parsed) {
    logClientError("api.oauthAPI", new Error("Incomplete OAuth auth response"), {
      body: raw,
      bodyKeys: raw && typeof raw === "object" ? Object.keys(raw as object) : [],
    });
    throw new Error(
      "Social sign-in returned an incomplete response. Please try again. If this continues, refresh the page or use email sign-in.",
    );
  }
  return parsed;
}

export type LinkedOAuthAccount = {
  provider: OAuthProviderId;
  emailAtLink: string | null;
  linkedAt: string;
};

export type LinkedOAuthAccountsResponse = {
  providers: LinkedOAuthAccount[];
  hasPassword: boolean;
};

export async function listLinkedOAuthAccountsAPI(): Promise<LinkedOAuthAccountsResponse> {
  return apiRequest<LinkedOAuthAccountsResponse>(apiPath("/api/auth/oauth/accounts"), {
    method: "GET",
    headers: getHeaders(),
    credentials: "include",
  });
}

export async function linkOAuthAccountAPI(
  provider: OAuthProviderId,
  idToken: string,
): Promise<{ provider: OAuthProviderId; linked: true }> {
  return apiRequest<{ provider: OAuthProviderId; linked: true }>(apiPath("/api/auth/oauth/link"), {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ provider, idToken }),
    credentials: "include",
  });
}

export async function unlinkOAuthAccountAPI(
  provider: OAuthProviderId,
): Promise<{ provider: OAuthProviderId; unlinked: true }> {
  return apiRequest<{ provider: OAuthProviderId; unlinked: true }>(apiPath("/api/auth/oauth/unlink"), {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ provider }),
    credentials: "include",
  });
}

export async function refreshSessionAPI(): Promise<AuthResponse> {
  const r = await ensureRefreshedSession();
  if (r.ok) return r.data;
  if (r.status === 503) {
    throw new Error(SERVICE_UNAVAILABLE_CLIENT_MESSAGE);
  }
  if (r.status === 500) {
    const m = fallbackMessageForHttpStatus(500);
    logClientError("api.refreshSessionAPI", new Error(`HTTP ${r.status}`), { status: r.status });
    throw new Error(m ?? "Our servers hit a problem. Please try again in a few minutes.");
  }
  if (r.status === 401 || r.status === 403) {
    throw new Error(fallbackMessageForHttpStatus(401) ?? "Your session has expired. Please sign in again.");
  }
  if (r.status === 0) {
    throw new Error(fallbackMessageForHttpStatus(503) ?? SERVICE_UNAVAILABLE_CLIENT_MESSAGE);
  }
  const fallback = fallbackMessageForHttpStatus(r.status);
  throw new Error(fallback ?? "Your session has expired. Please sign in again.");
}

export type BootstrapRefreshResult =
  | { kind: "authenticated"; data: AuthResponse }
  | { kind: "unauthenticated" }
  | { kind: "transient_error" };

/**
 * App-startup refresh — never throws for missing/expired refresh cookies (401/403).
 * Anonymous visitors and expired sessions are normal `unauthenticated` outcomes.
 */
export async function bootstrapRefreshSession(): Promise<BootstrapRefreshResult> {
  const r = await ensureRefreshedSession();
  if (r.ok) return { kind: "authenticated", data: r.data };
  if (
    r.status === 0 ||
    r.status === 503 ||
    r.status === 502 ||
    r.status === 504 ||
    r.status === 429 ||
    r.status >= 500
  ) {
    return { kind: "transient_error" };
  }
  return { kind: "unauthenticated" };
}

// Business
export async function generateInviteCode(): Promise<{ inviteCode: string; expiresAt: string }> {
  try {
    return await apiRequest(apiPath("/api/business/generate-invite"), {
      method: "POST",
      headers: getHeaders(),
      body: EMPTY_JSON_BODY,
      credentials: "include",
    });
  } catch (err) {
    logClientError("api.generateInviteCode", err);
    throw err;
  }
}

export interface BusinessDashboardStats {
  name?: string;
  slug?: string | null;
  kycVerificationStatus?: KycVerificationStatus;
  onboardingVerificationStatus?: OnboardingVerificationStatus;
  /** Selected period for totals and charts (matches query). */
  timeframe?: "week" | "month" | "year" | "all";
  totalTips?: number;
  tipCount?: number;
  employeeCount?: number;
  /** One row per bucket: week = Mon–Sun, month = day 1–N, year = Jan–Dec. Amounts match `totalTips` sum. */
  dailyTipDistribution?: Array<{ day: string; amount: number }>;
  employees?: Array<{
    id: string;
    name: string;
    jobTitle: string;
    slug?: string | null;
    avatar: string | null;
    phone?: string | null;
    tipsTotal: number;
    tipCount: number;
    rating: number | null;
    email?: string;
    /** Mirrors `User.email_verified`; used with activationStatus for roster display. */
    emailVerified?: boolean;
    /** True when `User.password_hash` is set or OAuth is linked — from DB only, never the hash. */
    passwordIsSet?: boolean;
    isActive?: boolean;
    /** Venue roster includes deactivated rows until deleted; activation is per-row in DB. */
    activationStatus?: "active" | "pending_activation" | "pending_verification";
    monthlyGoal?: number | null;
    locationId?: string | null;
    assignedTableIds?: string[];
  }>;
  /** Employee-created tip goals (read-only for managers). */
  employeeGoals?: Array<{
    employeeId: string;
    name: string;
    goalAmount: number;
    goalPeriod: GoalPeriod;
    startDate: string;
    currentAmount: number;
    percent: number;
    status: EmployeeGoalProgressStatus;
  }>;
  /** Timeframe-agnostic live snapshot (hero). Body cards use `timeframe` totals. */
  operationalPulse?: {
    tipsLast60m: { amount: number; count: number };
    tipsToday: { amount: number; count: number };
    tippingReadyEmployees: number;
    rosterTotal: number;
    employeesMissingQr: number;
    goalsTracked: number;
    goalsOnTrackOrBetter: number;
  };
  /** SQL location rankings for selected timeframe (not tip-feed samples). */
  locationRankings?: Array<{ id: string | null; name: string; tipsEur: number; tipCount: number }>;
  /** SQL table rankings for selected timeframe. */
  tableRankings?: Array<{ id: string | null; name: string; tipsEur: number; tipCount: number }>;
  /** Prior equal-length window tip totals for growth %. */
  priorPeriod?: { totalTips: number; tipCount: number };
  /** Period-over-prior growth % from SQL (WoW / MoM / YoY by timeframe). */
  growthPercent?: number;
  /** Venue-local peak tip hour 0–23 from SQL (null if no tips). */
  peakHour?: number | null;
  /** Best shift key from SQL: morning | afternoon | evening | late. */
  bestShift?: "morning" | "afternoon" | "evening" | "late" | null;
  /** periodTips ÷ completed (day×shift) buckets; null when no completed shifts. */
  avgTipsPerShift?: number | null;
  completedShifts?: number;
}

/**
 * Dashboard stats for the authenticated business owner (business resolved from JWT, not URL).
 * Avoids 404 when `caretip_user.businessId` is stale vs the database.
 */
/** In-flight dedupe + short TTL so aborted/remounted loads reuse fresh responses. */
const businessStatsInflight = new Map<string, Promise<BusinessDashboardStats>>();
const businessStatsResultCache = new Map<
  string,
  { at: number; value: BusinessDashboardStats }
>();
/** Align with DASHBOARD_SWR_METRICS_TTL_MS — shorter stale window, same hit rate under sockets. */
const BUSINESS_STATS_CLIENT_RESULT_TTL_MS = 45_000;

export type BusinessStatsScope = "summary" | "roster" | "analytics" | "full";

function businessStatsClientCacheKey(timeframe: string, scope: BusinessStatsScope = "full"): string {
  // Endpoint is scoped to the authenticated session (business resolved from JWT),
  // so using `caretip_user.id` here can cause *real* duplicate fetches during auth bootstrap
  // (first call sees anon, next call sees user) while the request is still in-flight.
  return `me:${scope}:${timeframe}`;
}

/** Merge summary + analytics payloads from split dashboard stats requests. */
export function mergeBusinessDashboardStats(
  summary: Partial<BusinessDashboardStats> | null | undefined,
  analytics: Partial<BusinessDashboardStats> | null | undefined,
): BusinessDashboardStats | null {
  if (!summary && !analytics) return null;
  const pulseS = summary?.operationalPulse;
  const pulseA = analytics?.operationalPulse;
  return {
    ...(analytics ?? {}),
    ...(summary ?? {}),
    totalTips:
      summary?.totalTips != null ? summary.totalTips : (analytics?.totalTips ?? summary?.totalTips),
    tipCount:
      summary?.tipCount != null ? summary.tipCount : (analytics?.tipCount ?? summary?.tipCount),
    employeeCount:
      summary?.employeeCount != null
        ? summary.employeeCount
        : (analytics?.employeeCount ?? summary?.employeeCount ?? 0),
    dailyTipDistribution:
      analytics?.dailyTipDistribution ?? summary?.dailyTipDistribution,
    locationRankings: analytics?.locationRankings ?? summary?.locationRankings,
    tableRankings: analytics?.tableRankings ?? summary?.tableRankings,
    priorPeriod: analytics?.priorPeriod ?? summary?.priorPeriod,
    growthPercent: analytics?.growthPercent ?? summary?.growthPercent,
    peakHour: analytics?.peakHour ?? summary?.peakHour,
    bestShift: analytics?.bestShift ?? summary?.bestShift,
    avgTipsPerShift: analytics?.avgTipsPerShift ?? summary?.avgTipsPerShift,
    completedShifts: analytics?.completedShifts ?? summary?.completedShifts,
    employees: analytics?.employees ?? summary?.employees,
    employeeGoals: analytics?.employeeGoals ?? summary?.employeeGoals,
    operationalPulse:
      pulseS || pulseA
        ? {
            tipsLast60m: pulseS?.tipsLast60m ?? { amount: 0, count: 0 },
            tipsToday: pulseS?.tipsToday ?? { amount: 0, count: 0 },
            tippingReadyEmployees: pulseS?.tippingReadyEmployees ?? 0,
            rosterTotal: pulseS?.rosterTotal ?? 0,
            employeesMissingQr: pulseS?.employeesMissingQr ?? 0,
            goalsTracked: pulseA?.goalsTracked ?? pulseS?.goalsTracked ?? 0,
            goalsOnTrackOrBetter:
              pulseA?.goalsOnTrackOrBetter ?? pulseS?.goalsOnTrackOrBetter ?? 0,
          }
        : undefined,
  } as BusinessDashboardStats;
}

export function clearBusinessStatsClientCache(timeframe?: "week" | "month" | "year" | "all"): void {
  if (timeframe) {
    for (const key of [...businessStatsInflight.keys()]) {
      if (key.includes(`:${timeframe}`)) {
        businessStatsInflight.delete(key);
      }
    }
    for (const key of [...businessStatsResultCache.keys()]) {
      if (key.includes(`:${timeframe}`)) {
        businessStatsResultCache.delete(key);
      }
    }
    return;
  }
  businessStatsInflight.clear();
  businessStatsResultCache.clear();
}

export function invalidateBusinessStatsClientCache(timeframe?: "week" | "month" | "year" | "all"): void {
  clearBusinessStatsClientCache(timeframe);
}

export type BusinessQrAnalyticsTimeframe = "week" | "month" | "year";

export type BusinessQrAnalytics = {
  timeframe: BusinessQrAnalyticsTimeframe;
  totalScans: number;
  uniqueScans: number;
  repeatScans: number;
  scansByLocation: Array<{ label: string; id: string; count: number }>;
  scansByEmployee: Array<{ label: string; id: string; count: number }>;
  scansByTable: Array<{ label: string; id: string; count: number }>;
  scansByQrSlug: Array<{ qrSlug: string; count: number }>;
  scansByDevice: Array<{ deviceType: string; count: number }>;
  scanTrend: Array<{ label: string; count: number }>;
  recentScans: Array<{ scannedAt: string; scanType: string; label: string }>;
};

export async function getBusinessQrAnalytics(
  timeframe: BusinessQrAnalyticsTimeframe = "month",
  opts?: { signal?: AbortSignal; silent?: boolean },
): Promise<BusinessQrAnalytics> {
  const statsUrl = apiPath(
    `/api/business/qr-analytics?${new URLSearchParams({ timeframe }).toString()}`,
  );
  return apiRequest<BusinessQrAnalytics>(statsUrl, {
    headers: getHeaders(),
    credentials: "include",
    signal: opts?.signal,
    caretipSilentErrors: opts?.silent === true,
  } as CaretipRequestInit);
}

export async function getBusinessStats(
  timeframe?: "week" | "month" | "year" | "all",
  opts?: {
    silent?: boolean;
    signal?: AbortSignal;
    scope?: BusinessStatsScope;
    revalidate?: boolean;
  },
): Promise<BusinessDashboardStats> {
  const tf = timeframe ?? "month";
  const scope = opts?.scope ?? "full";
  if (opts?.signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
  const cacheKey = businessStatsClientCacheKey(tf, scope);
  if (opts?.revalidate) {
    businessStatsResultCache.delete(cacheKey);
  }
  const resultHit = businessStatsResultCache.get(cacheKey);
  if (
    !opts?.revalidate &&
    resultHit &&
    Date.now() - resultHit.at < BUSINESS_STATS_CLIENT_RESULT_TTL_MS
  ) {
    return resultHit.value;
  }
  const inflight = businessStatsInflight.get(cacheKey);
  const statsUrl = apiPath(
    `/api/business/me/stats?${new URLSearchParams({ timeframe: tf, scope }).toString()}`,
  );
  logDashboardTenantRequest("GET /api/business/me/stats", { timeframe: tf, scope });
  if (inflight) {
    if (opts?.revalidate) {
      businessStatsInflight.delete(cacheKey);
    } else {
      const target = resolveDashboardApiDebugTarget(statsUrl);
      if (target) devTrackDeduped(target.group, target.key, { ...target.meta, inflight: true });
      return inflight;
    }
  }

  const promise = apiRequest<BusinessDashboardStats>(
    statsUrl,
    {
      headers: getHeaders(),
      credentials: "include",
      signal: opts?.signal,
      caretipSilentErrors: opts?.silent === true,
    } as CaretipRequestInit,
  )
    .then((value) => {
      businessStatsResultCache.set(cacheKey, { at: Date.now(), value });
      return value;
    })
    .finally(() => {
      if (businessStatsInflight.get(cacheKey) === promise) {
        businessStatsInflight.delete(cacheKey);
      }
    });

  businessStatsInflight.set(cacheKey, promise);
  return promise;
}

/**
 * Downloads all tips for the authenticated business as CSV (server resolves business from JWT only).
 * Filename: CareTip_Transactions_YYYY-MM-DD.csv
 */
export async function downloadBusinessTransactionsExport(): Promise<void> {
  const token = getToken();
  const res = await fetch(apiPath("/api/transactions/export"), {
    method: "GET",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: "include",
  });

  if (!res.ok) {
    const ct = res.headers.get("content-type") ?? "";
    let errData: unknown = {};
    if (ct.includes("application/json")) {
      errData = await res.json().catch(() => ({}));
    } else {
      const text = await res.text().catch(() => "");
      errData = text.trim() ? { message: text.trim().slice(0, 300) } : {};
    }
    logClientError("api.downloadBusinessTransactionsExport", new Error(`HTTP ${res.status}`), {
      status: res.status,
      body: errData,
    });
    throw new Error("Export failed. Please try again.");
  }

  const blob = await res.blob();
  const { venueLocalTodayKey, resolveBusinessTimezone } = await import("./businessVenueTime");
  const dateStr = venueLocalTodayKey(resolveBusinessTimezone());
  const filename = `CareTip_Transactions_${dateStr}.csv`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  try {
    const { recordFeatureUtilizationNow } = await import("./commercial/featureUtilizationTracker");
    recordFeatureUtilizationNow("csv_export");
  } catch {
    // ignore
  }
}

export interface BusinessInfo {
  id: string;
  name: string;
  /** Alias returned by public/manager profile DTOs — same as `name`. */
  businessName?: string;
  /** Public directory path: `/{slug}` */
  slug?: string | null;
  logo: string | null;
  location?: string | null;
  registeredAddress?: string | null;
  type?: string | null;
  contactPhone?: string | null;
  /** Manager profile only — used to prefill Physical QR delivery. */
  legalContactName?: string | null;
  contactEmail?: string | null;
  website?: string | null;
  /** IANA venue timezone (manager profile) — Activity Center calendar labels. */
  timezone?: string | null;
  /** Present on manager profile only — not returned by public GET /api/business/:id */
  employeeCount?: number;
  /** @deprecated Legacy KYC mirror — use `kycVerificationStatus`. */
  verificationStatus?: "pending" | "verified" | "rejected";
  onboardingVerificationStatus?: OnboardingVerificationStatus;
  kycVerificationStatus?: KycVerificationStatus;
  /** SaaS tier for entitlement UI; manager profile only. Null when no subscription. */
  subscriptionTier?: "basic" | "premium" | "enterprise" | null;
  subscriptionStatus?: "none" | "trialing" | "active" | "past_due" | "canceled" | "unpaid" | "incomplete";
  hasActiveSubscription?: boolean;
  accessSource?: "none" | "subscription" | "sponsored";
  sponsoredProgrammeKey?: string | null;
  sponsoredProgrammeLabelKey?: string | null;
  capabilities?: import("./subscriptionCapabilities").SubscriptionCapability[];
  limits?: import("./subscriptionCapabilities").PlanLimits;
  /** Explicit finish persisted on the user row. */
  onboardingCompleted?: boolean;
  /** Resume wizard at 1–3 from saved profile fields. */
  onboardingStep?: number;
  /** Guest-facing branding (tier-resolved on public API). */
  branding?: import("./businessBranding").PublicGuestBranding;
}

export type BusinessBrandingSettings = import("./businessBranding").BusinessBrandingSettings;

export function invalidateBusinessProfileCache(): void {
  businessProfileCache = null;
  businessProfileInflight = null;
}

export async function getBusinessById(businessId: string): Promise<BusinessInfo | null> {
  return apiRequest(apiPath(`/api/business/${businessId}`), {
    headers: { ...getHeaders(), ...guestQrScanHeaders() },
  });
}

export async function fetchPublicSocketRoomToken(opts: {
  businessId?: string;
  businessSlug?: string;
}): Promise<{ businessId: string; token: string; expiresAt: string }> {
  const params = new URLSearchParams();
  if (opts.businessId?.trim()) params.set("businessId", opts.businessId.trim());
  if (opts.businessSlug?.trim()) params.set("businessSlug", opts.businessSlug.trim());
  return apiRequest(apiPath(`/api/socket/public-room-token?${params.toString()}`));
}

/** Authenticated manager: returns only the business tied to the JWT (not arbitrary IDs). */
let businessProfileInflight: Promise<BusinessInfo> | null = null;
let businessProfileCache: { at: number; data: BusinessInfo } | null = null;
const BUSINESS_PROFILE_CLIENT_TTL_MS = 15_000;

export function clearBusinessProfileClientCache(): void {
  businessProfileCache = null;
  businessProfileInflight = null;
}

let brandingSettingsCache: { at: number; data: BusinessBrandingSettings } | null = null;
let brandingSettingsInflight: Promise<BusinessBrandingSettings> | null = null;
const BUSINESS_BRANDING_SETTINGS_TTL_MS = 15_000;

export function clearBusinessBrandingSettingsClientCache(): void {
  brandingSettingsCache = null;
  brandingSettingsInflight = null;
}

function primeBusinessSubscriptionTier(profile: BusinessInfo): void {
  const tier = resolveSubscriptionTier(profile.subscriptionTier);
  const accessSource = profile.accessSource ?? (tier ? "subscription" : "none");
  const status = profile.subscriptionStatus ?? (accessSource !== "none" ? "active" : "none");
  primeSubscriptionEntitlementsFromSession({ tier, status, accessSource });
  primeSubscriptionTierFromSession(tier ?? undefined);
}

export async function fetchBusinessProfile(opts?: {
  silent?: boolean;
  /** Bypass the in-memory TTL (e.g. after Stripe checkout webhook sync). */
  revalidate?: boolean;
}): Promise<BusinessInfo> {
  const now = Date.now();
  if (
    !opts?.revalidate &&
    businessProfileCache &&
    now - businessProfileCache.at < BUSINESS_PROFILE_CLIENT_TTL_MS
  ) {
    primeBusinessSubscriptionTier(businessProfileCache.data);
    if (businessProfileCache.data.timezone) {
      void import("./businessVenueTime").then(({ setCachedBusinessVenueTimezone }) => {
        setCachedBusinessVenueTimezone(businessProfileCache!.data.timezone);
      });
    }
    return businessProfileCache.data;
  }
  if (businessProfileInflight) return businessProfileInflight;

  const promise = apiRequest<BusinessInfo>(apiPath("/api/business/profile"), {
    headers: getHeaders(),
    credentials: "include",
    caretipSilentErrors: opts?.silent === true,
  } as CaretipRequestInit)
    .then((data) => {
      businessProfileCache = { at: Date.now(), data };
      primeBusinessSubscriptionTier(data);
      if (data.timezone) {
        void import("./businessVenueTime").then(({ setCachedBusinessVenueTimezone }) => {
          setCachedBusinessVenueTimezone(data.timezone);
        });
      }
      return data;
    })
    .finally(() => {
      businessProfileInflight = null;
    });

  businessProfileInflight = promise;
  return promise;
}

export async function regenerateBusinessSlug(): Promise<{ slug: string }> {
  return apiRequest<{ slug: string }>(apiPath("/api/business/profile/slug/regenerate"), {
    method: "POST",
    headers: getHeaders(),
    body: EMPTY_JSON_BODY,
    credentials: "include",
  });
}

export async function validateInviteCode(code: string): Promise<{
  ok: true;
  businessName?: string;
  businessId?: string;
  businessSlug?: string;
  businessLocation?: string | null;
}> {
  const sp = new URLSearchParams({ code: String(code ?? "").trim() });
  return apiRequest<{
    ok: true;
    businessName?: string;
    businessId?: string;
    businessSlug?: string;
    businessLocation?: string | null;
  }>(apiPath(`/api/business/invite/validate?${sp.toString()}`), {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
  });
}

export async function patchMyOnboardingStatus(hasCompletedOnboarding: boolean): Promise<AuthResponse> {
  return apiRequest<AuthResponse>(apiPath("/api/auth/me"), {
    method: "PATCH",
    headers: getHeaders(),
    body: JSON.stringify({ hasCompletedOnboarding }),
    credentials: "include",
  });
}

export async function patchBusinessProfile(body: {
  name?: string;
  legalBusinessName?: string;
  businessType?: string | null;
  location?: string | null;
  registeredAddress?: string | null;
  contactPhone?: string | null;
  website?: string | null;
}): Promise<BusinessInfo> {
  const result = await apiRequest<BusinessInfo>(apiPath("/api/business/profile"), {
    method: "PATCH",
    headers: getHeaders(),
    body: JSON.stringify(body),
    credentials: "include",
  });
  invalidateBusinessProfileCache();
  return result;
}

export type KycDocumentType = "registration" | "address" | "governmentId" | "additional";
export type KycUiStatus = "PENDING_UPLOAD" | "UNDER_REVIEW" | "APPROVED" | "REJECTED";

export type KycStatusResponse = {
  businessId: string;
  verificationStatus: "pending" | "verified" | "rejected";
  kycUiStatus: KycUiStatus;
  kycDocuments: {
    registration?: string | null;
    address?: string | null;
    governmentId?: string | null;
    additional?: string[];
  };
  kycSubmittedAt: string | null;
  requiredDocumentTypes: KycDocumentType[];
  timeline: Array<{ status: string; at: string; label: string }>;
};

export async function fetchKycStatus(): Promise<KycStatusResponse> {
  return apiRequest<KycStatusResponse>(apiPath("/api/business/kyc/status"), {
    headers: getHeaders(),
    credentials: "include",
  });
}

export async function uploadKycDocument(
  documentType: KycDocumentType,
  file: File,
): Promise<{
  success: boolean;
  path: string;
  documentType: KycDocumentType;
  kycUiStatus: KycUiStatus;
  kycDocuments: KycStatusResponse["kycDocuments"];
}> {
  const form = new FormData();
  form.append("file", file);
  form.append("documentType", documentType);
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token?.trim()) headers.Authorization = `Bearer ${token.trim()}`;
  const res = await fetch(apiPath("/api/business/kyc/documents"), {
    method: "POST",
    headers,
    body: form,
    credentials: "include",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message ?? "Upload failed");
  }
  return res.json() as Promise<{
    success: boolean;
    path: string;
    documentType: KycDocumentType;
    kycUiStatus: KycUiStatus;
    kycDocuments: KycStatusResponse["kycDocuments"];
  }>;
}

export async function submitKycForReview(): Promise<KycStatusResponse> {
  const r = await apiRequest<KycStatusResponse & { success?: boolean }>(
    apiPath("/api/business/kyc/submit"),
    {
      method: "POST",
      headers: getHeaders(),
      body: EMPTY_JSON_BODY,
      credentials: "include",
    },
  );
  invalidateBusinessProfileCache();
  return r;
}

/** Same payload as PATCH — PUT for clients that expect REST “replace” semantics. */
export async function putBusinessProfile(body: {
  name?: string;
  businessType?: string | null;
  location?: string | null;
  registeredAddress?: string | null;
  contactPhone?: string | null;
  website?: string | null;
}): Promise<BusinessInfo> {
  return apiRequest<BusinessInfo>(apiPath("/api/business/profile"), {
    method: "PUT",
    headers: getHeaders(),
    body: JSON.stringify(body),
    credentials: "include",
  });
}

export async function uploadMyBusinessLogo(file: File): Promise<{ success: boolean; path: string }> {
  const check = validateImageFileForUpload(file);
  if (!check.ok) {
    throw new Error(toUserFriendlyMessage(new Error(check.message)));
  }
  const form = new FormData();
  form.append("file", file);
  return apiRequest(apiPath("/api/business/profile/logo"), {
    method: "POST",
    headers: getAuthHeadersOnly(),
    body: form,
    credentials: "include",
  });
}

export async function fetchBusinessBrandingSettings(): Promise<BusinessBrandingSettings> {
  const now = Date.now();
  if (brandingSettingsCache && now - brandingSettingsCache.at < BUSINESS_BRANDING_SETTINGS_TTL_MS) {
    return brandingSettingsCache.data;
  }
  if (brandingSettingsInflight) return brandingSettingsInflight;

  const promise = apiRequest<BusinessBrandingSettings>(apiPath("/api/business/profile/branding"), {
    headers: getHeaders(),
    credentials: "include",
  }).then((data) => {
    brandingSettingsCache = { at: Date.now(), data };
    return data;
  });

  brandingSettingsInflight = promise.finally(() => {
    brandingSettingsInflight = null;
  });
  return brandingSettingsInflight;
}

export async function patchBusinessBrandingSettings(body: {
  brandPrimaryColor?: string;
  brandSecondaryColor?: string;
  welcomeMessage?: string | null;
  thankYouMessage?: string | null;
  brandDisplayName?: string | null;
  brandTagline?: string | null;
  qrTemplate?: string;
  qrBorderStyle?: string;
  qrShape?: string;
  qrAccentColor?: string | null;
  qrBackgroundColor?: string;
}): Promise<BusinessBrandingSettings> {
  const result = await apiRequest<BusinessBrandingSettings>(apiPath("/api/business/profile/branding"), {
    method: "PATCH",
    headers: getHeaders(),
    body: JSON.stringify(body),
    credentials: "include",
  });
  brandingSettingsCache = { at: Date.now(), data: result };
  return result;
}

export async function uploadMyBusinessBanner(file: File): Promise<{ success: boolean; path: string }> {
  const check = validateImageFileForUpload(file);
  if (!check.ok) {
    throw new Error(toUserFriendlyMessage(new Error(check.message)));
  }
  const form = new FormData();
  form.append("file", file);
  return apiRequest(apiPath("/api/business/profile/banner"), {
    method: "POST",
    headers: getAuthHeadersOnly(),
    body: form,
    credentials: "include",
  });
}

/** Coerce list endpoints that may return a bare array or `{ items | data | … }`. */
function normalizeApiList<T>(raw: unknown, nestedKeys: string[]): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    for (const key of nestedKeys) {
      const nested = record[key];
      if (Array.isArray(nested)) return nested as T[];
    }
  }
  return [];
}

// Employees
export interface EmployeeItem {
  id: string;
  slug: string | null;
  name: string;
  role: string;
  avatar: string | null;
  rating: number | null;
  tips: number;
  topRated: boolean;
}

export async function getEmployees(businessId: string): Promise<EmployeeItem[]> {
  const raw = await apiRequest<unknown>(
    apiPath(`/api/employees?businessId=${encodeURIComponent(businessId)}`),
    { headers: getHeaders() },
  );
  return normalizeApiList<EmployeeItem>(raw, ["employees", "items", "data"]);
}

export async function regenerateEmployeeSlug(employeeId: string): Promise<{
  id: string;
  name: string;
  jobTitle: string;
  slug: string | null;
  avatar: string | null;
  email: string;
}> {
  return apiRequest(apiPath(`/api/employees/${encodeURIComponent(employeeId)}/regenerate-slug`), {
    method: "POST",
    headers: getHeaders(),
    body: EMPTY_JSON_BODY,
    credentials: "include",
  });
}

/** Idempotent: create staff slug if missing (manager). Does not rotate existing slugs. */
export async function ensureEmployeeSlugForBusiness(employeeId: string): Promise<{
  id: string;
  name: string;
  jobTitle: string;
  slug: string | null;
  avatar: string | null;
  email: string;
}> {
  return apiRequest(apiPath(`/api/employees/${encodeURIComponent(employeeId)}/ensure-slug`), {
    method: "POST",
    headers: getHeaders(),
    body: EMPTY_JSON_BODY,
    credentials: "include",
  });
}

/** QR Studio SSOT — ensure every tipping-ready employee has a public slug. */
export async function ensureMissingEmployeeSlugs(): Promise<{
  ensured: Array<{ id: string; slug: string }>;
  skipped: Array<{ id: string; reason: string }>;
}> {
  return apiRequest(apiPath("/api/employees/ensure-slugs"), {
    method: "POST",
    headers: getHeaders(),
    body: EMPTY_JSON_BODY,
    credentials: "include",
  });
}

export interface EmployeeDetail {
  id: string;
  name: string;
  role: string;
  bio?: string | null;
  avatar: string | null;
  businessId: string;
  businessSlug: string | null;
  /** API path or URL for venue logo on customer flows. */
  businessLogo?: string | null;
  businessName?: string;
  branding?: import("./businessBranding").PublicGuestBranding | null;
  slug: string | null;
}

export async function getEmployeeById(employeeId: string): Promise<EmployeeDetail> {
  return apiRequest(apiPath(`/api/employees/${encodeURIComponent(employeeId)}`), {
    headers: { ...getHeaders(), ...guestQrScanHeaders() },
  });
}

export interface StaffBySlugResponse {
  id: string;
  name: string;
  slug: string | null;
  avatar: string | null;
  jobTitle: string;
  bio: string | null;
  businessId: string;
  businessName: string;
  businessSlug: string;
  businessLogo?: string | null;
  branding?: import("./businessBranding").PublicGuestBranding | null;
}

export async function getStaffBySlug(slug: string): Promise<StaffBySlugResponse> {
  return apiRequest(apiPath(`/api/staff/${encodeURIComponent(slug)}`), {
    headers: { ...getHeaders(), ...guestQrScanHeaders() },
  });
}

export async function getStaffByBusinessEmployeeSlug(
  businessSlug: string,
  employeeSlug: string
): Promise<StaffBySlugResponse> {
  return apiRequest(
    apiPath(
      `/api/staff/directory/business/${encodeURIComponent(businessSlug)}/employee/${encodeURIComponent(employeeSlug)}`
    ),
    { headers: { ...getHeaders(), ...guestQrScanHeaders() } }
  );
}

export interface BusinessDirectoryEmployee {
  id: string;
  name: string;
  slug: string | null;
  jobTitle: string;
  avatar: string | null;
}

export interface BusinessDirectoryResponse {
  business: {
    id: string;
    name: string;
    slug: string | null;
    logo?: string | null;
    type?: string | null;
    location?: string | null;
  };
  employees: BusinessDirectoryEmployee[];
}

/** Public: active staff for business team QR (/business/:slug) */
export async function getBusinessStaffDirectory(
  businessSlug: string
): Promise<BusinessDirectoryResponse> {
  return apiRequest<BusinessDirectoryResponse>(
    apiPath(`/api/staff/directory/business/${encodeURIComponent(businessSlug)}`),
    { headers: { ...getHeaders(), ...guestQrScanHeaders() } }
  );
}

export async function createEmployee(payload: {
  name: string;
  role: string;
  email: string;
  phone?: string;
  locationId?: string | null;
  tableIds?: string[];
  /** Invite email language (`en` / `de`). */
  locale?: "en" | "de";
}): Promise<{
  id: string;
  name: string;
  jobTitle: string;
  email: string;
  locationId?: string | null;
  assignedTableIds?: string[];
  expiresAt?: string;
}> {
  return apiRequest(apiPath("/api/employees"), {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(payload),
    credentials: "include",
  });
}

export async function updateEmployee(
  employeeId: string,
  payload: {
    name?: string;
    role?: string;
    jobTitle?: string;
    monthlyGoal?: number | null;
    isActive?: boolean;
    email?: string;
    locationId?: string | null;
    tableIds?: string[];
  }
): Promise<{
  id: string;
  name: string;
  jobTitle: string;
  slug: string | null;
  avatar: string | null;
  monthlyGoal: number | null;
  isActive: boolean;
  email: string;
  locationId?: string | null;
  assignedTableIds?: string[];
}> {
  return apiRequest(apiPath(`/api/employees/${encodeURIComponent(employeeId)}`), {
    method: "PATCH",
    headers: getHeaders(),
    body: JSON.stringify(payload),
    credentials: "include",
  });
}

export async function updateEmployeeStatus(
  employeeId: string,
  isActive: boolean
): Promise<{
  id: string;
  name: string;
  jobTitle: string;
  slug: string | null;
  avatar: string | null;
  monthlyGoal: number | null;
  isActive: boolean;
  email: string;
  locationId?: string | null;
  assignedTableIds?: string[];
}> {
  return apiRequest(apiPath(`/api/employees/${encodeURIComponent(employeeId)}/status`), {
    method: "PATCH",
    headers: getHeaders(),
    body: JSON.stringify({ isActive }),
    credentials: "include",
  });
}

export async function deleteEmployee(employeeId: string): Promise<void> {
  await apiRequest<void>(apiPath(`/api/employees/${encodeURIComponent(employeeId)}`), {
    method: "DELETE",
    headers: getHeaders(),
    credentials: "include",
  });
}

// Tips
export interface TipItem {
  id: string;
  amount: number;
  status: string;
  createdAt: string;
}

export type TipStatus = "success" | "pending" | "failed";

export type TipActivityRow = {
  id: string;
  amount: number;
  status: TipStatus | string;
  createdAt: string;
  employeeId: string;
  locationId: string | null;
  tableId: string | null;
  staffName: string | null;
  locationName: string | null;
  tableName: string | null;
};

export async function listBusinessTips(params: {
  take?: number;
  skip?: number;
  q?: string;
  status?: TipStatus;
  /** Optional preset range handled by backend in business timezone */
  range?: "today" | "week" | "month" | "custom";
  /** Custom local dates (YYYY-MM-DD). Backend converts using business timezone. */
  fromDate?: string;
  toDate?: string;
  /** Legacy UTC instants (kept for backwards compatibility) */
  from?: string;
  to?: string;
  employeeId?: string;
  locationId?: string;
  tableId?: string;
}): Promise<{ timezone?: string; total: number; items: TipActivityRow[] }> {
  const sp = new URLSearchParams();
  if (params.take != null) sp.set("take", String(params.take));
  if (params.skip != null) sp.set("skip", String(params.skip));
  if (params.q?.trim()) sp.set("q", params.q.trim());
  if (params.status) sp.set("status", params.status);
  if (params.range) sp.set("range", params.range);
  if (params.fromDate) sp.set("fromDate", params.fromDate);
  if (params.toDate) sp.set("toDate", params.toDate);
  if (params.from) sp.set("from", params.from);
  if (params.to) sp.set("to", params.to);
  if (params.employeeId) sp.set("employeeId", params.employeeId);
  if (params.locationId) sp.set("locationId", params.locationId);
  if (params.tableId) sp.set("tableId", params.tableId);
  const qs = sp.toString();
  return apiRequest(apiPath(`/api/tips/business${qs ? `?${qs}` : ""}`), { headers: getHeaders(), credentials: "include" });
}

/** Activity Center — SSOT feed from BusinessActivityEvent (cursor + source filter). */
export type ActivityEventSource =
  | "TIPS"
  | "QR"
  | "GOALS"
  | "STAFF"
  | "PAYMENTS"
  | "SYSTEM";

export type ActivityEventPriority = "LOW" | "NORMAL" | "HIGH";

export type BusinessActivityFeedItem = {
  id: string;
  type: string;
  source: ActivityEventSource;
  priority: ActivityEventPriority;
  occurredAt: string;
  titleKey: string;
  params: Record<string, unknown>;
  subject: { type: string; id: string } | null;
  actorEmployeeId: string | null;
  locationId: string | null;
  tableId: string | null;
};

export type BusinessActivityListResult = {
  items: BusinessActivityFeedItem[];
  nextCursor: string | null;
};

export async function fetchBusinessActivity(params?: {
  limit?: number;
  cursor?: string | null;
  source?: ActivityEventSource | "all";
}): Promise<BusinessActivityListResult> {
  const q = new URLSearchParams();
  if (params?.limit != null) q.set("limit", String(params.limit));
  if (params?.cursor) q.set("cursor", params.cursor);
  if (params?.source && params.source !== "all") q.set("source", params.source);
  const suffix = q.toString() ? `?${q.toString()}` : "";
  const raw = await apiRequest<BusinessActivityListResult>(apiPath(`/api/business/activity${suffix}`), {
    method: "GET",
    headers: getHeaders(),
    credentials: "include",
    caretipSilentErrors: true,
  } as CaretipRequestInit);
  return {
    items: Array.isArray(raw.items) ? raw.items : [],
    nextCursor: raw.nextCursor ?? null,
  };
}

export async function listEmployeeTips(params: {
  take?: number;
  skip?: number;
  q?: string;
  status?: TipStatus;
  /** Optional preset range handled by backend in business timezone */
  range?: "today" | "week" | "month" | "custom";
  /** Custom local dates (YYYY-MM-DD). Backend converts using business timezone. */
  fromDate?: string;
  toDate?: string;
  /** Legacy UTC instants (kept for backwards compatibility) */
  from?: string;
  to?: string;
}): Promise<{ timezone?: string; total: number; items: TipActivityRow[] }> {
  const sp = new URLSearchParams();
  if (params.take != null) sp.set("take", String(params.take));
  if (params.skip != null) sp.set("skip", String(params.skip));
  if (params.q?.trim()) sp.set("q", params.q.trim());
  if (params.status) sp.set("status", params.status);
  if (params.range) sp.set("range", params.range);
  if (params.fromDate) sp.set("fromDate", params.fromDate);
  if (params.toDate) sp.set("toDate", params.toDate);
  if (params.from) sp.set("from", params.from);
  if (params.to) sp.set("to", params.to);
  const qs = sp.toString();
  return apiRequest(apiPath(`/api/tips/employee/list${qs ? `?${qs}` : ""}`), { headers: getHeaders(), credentials: "include" });
}

export type GoalPeriod = "daily" | "weekly" | "monthly";

export type EmployeeGoalProgressStatus = "achieved" | "on_track" | "below_target";

export interface EmployeeGoalProgress {
  id: string;
  employeeId: string;
  name?: string;
  lifecycleStatus?: "active" | "archived";
  goalAmount: number;
  goalPeriod: GoalPeriod;
  startDate: string;
  currentAmount: number;
  percent: number;
  status: EmployeeGoalProgressStatus;
}

export interface EmployeeTipsResponse {
  tips: TipItem[];
  monthlyGoal: number | null;
  currentMonthTotal: number;
  goal: EmployeeGoalProgress | null;
  businessTimezone?: string;
  /** Server aggregate for selected period — matches `tips` and `chartSeries` */
  periodAmountEur?: number;
  periodTipCount?: number;
  chartSeries?: Array<{ label: string; amount: number }>;
  /** Summary scope includes chart/tips from the same SQL bundle (skip analytics round-trip). */
  analyticsBundled?: boolean;
  /** Lifetime successful tips — hero account summary */
  totalEarningsEur?: number;
  /** @deprecated Prefer paidOutEur */
  availableBalanceEur?: number;
  /** Successful tips with payout_status=paid */
  paidOutEur?: number;
  totalSupporters?: number;
  /** Period-scoped guest ratings (summary scope). */
  averageRating?: number | null;
  ratingCount?: number;
}

export type EmployeeGoalStatus = "active" | "archived";

export type EmployeeGoalRow = {
  id: string;
  name: string;
  goalAmount: number;
  goalPeriod: GoalPeriod;
  status: EmployeeGoalStatus;
  startDate: string;
  createdAt: string;
  updatedAt: string;
};

export async function listMyGoals(): Promise<{ goals: EmployeeGoalRow[] }> {
  return apiRequest(apiPath("/api/goals"), { headers: getHeaders(), credentials: "include" });
}

export async function createMyGoal(payload: {
  name: string;
  goalAmount: number;
  goalPeriod: GoalPeriod;
  startDate: string;
}): Promise<{ goal: EmployeeGoalRow }> {
  return apiRequest(apiPath("/api/goals"), {
    method: "POST",
    headers: getHeaders(),
    credentials: "include",
    body: JSON.stringify(payload),
  });
}

export async function updateMyGoal(
  goalId: string,
  payload: Partial<{ name: string; goalAmount: number; goalPeriod: GoalPeriod; startDate: string }>
): Promise<{ goal: EmployeeGoalRow }> {
  return apiRequest(apiPath(`/api/goals/${encodeURIComponent(goalId)}`), {
    method: "PUT",
    headers: getHeaders(),
    credentials: "include",
    body: JSON.stringify(payload),
  });
}

export async function archiveMyGoal(goalId: string): Promise<{ goal: EmployeeGoalRow }> {
  return apiRequest(apiPath(`/api/goals/${encodeURIComponent(goalId)}/archive`), {
    method: "POST",
    headers: getHeaders(),
    body: EMPTY_JSON_BODY,
    credentials: "include",
  });
}

export async function deleteMyGoalById(goalId: string): Promise<void> {
  await apiRequest<void>(apiPath(`/api/goals/${encodeURIComponent(goalId)}`), {
    method: "DELETE",
    headers: getHeaders(),
    credentials: "include",
  });
}

export async function getEmployeeGoal(): Promise<{ goal: EmployeeGoalProgress | null }> {
  return apiRequest(apiPath("/api/employees/me/goal"), { headers: getHeaders(), credentials: "include" });
}

export async function upsertEmployeeGoal(payload: {
  goalAmount: number;
  goalPeriod: GoalPeriod;
  startDate: string;
}): Promise<{ goal: EmployeeGoalProgress }> {
  return apiRequest(apiPath("/api/employees/me/goal"), {
    method: "PUT",
    headers: getHeaders(),
    credentials: "include",
    body: JSON.stringify(payload),
  });
}

export async function deleteEmployeeGoal(): Promise<void> {
  await apiRequest<void>(apiPath("/api/employees/me/goal"), {
    method: "DELETE",
    headers: getHeaders(),
    credentials: "include",
  });
}

/** In-flight dedupe only — no TTL metric cache (dashboards are live-first). */
const employeeTipsInflight = new Map<string, Promise<EmployeeTipsResponse>>();

export type EmployeeTipsScope = "account" | "summary" | "analytics" | "full";

export type EmployeeAccountSnapshot = {
  totalEarningsEur: number;
  /** @deprecated Prefer paidOutEur */
  availableBalanceEur: number;
  paidOutEur: number;
  totalSupporters: number;
};

function employeeTipsCacheKey(timeframe: string, scope: EmployeeTipsScope = "full"): string {
  // Endpoint is scoped to the authenticated session (employee resolved from JWT),
  // so using `caretip_user.id` can cause *real* duplicate fetches during auth bootstrap.
  return `me:${scope}:${timeframe}`;
}

export function mergeEmployeeTipsResponse(
  summary: Partial<EmployeeTipsResponse> | null | undefined,
  analytics: Partial<EmployeeTipsResponse> | null | undefined,
): EmployeeTipsResponse | null {
  if (!summary && !analytics) return null;
  return {
    tips: analytics?.tips ?? summary?.tips ?? [],
    monthlyGoal: summary?.monthlyGoal ?? analytics?.monthlyGoal ?? null,
    currentMonthTotal: summary?.currentMonthTotal ?? analytics?.currentMonthTotal ?? 0,
    goal: summary?.goal ?? analytics?.goal ?? null,
    businessTimezone: summary?.businessTimezone ?? analytics?.businessTimezone,
    periodAmountEur:
      typeof summary?.periodAmountEur === "number"
        ? summary.periodAmountEur
        : analytics?.periodAmountEur,
    periodTipCount:
      typeof summary?.periodTipCount === "number"
        ? summary.periodTipCount
        : analytics?.periodTipCount,
    averageRating:
      summary?.averageRating !== undefined
        ? summary.averageRating
        : (analytics?.averageRating ?? null),
    ratingCount:
      typeof summary?.ratingCount === "number"
        ? summary.ratingCount
        : (analytics?.ratingCount ?? 0),
    chartSeries: analytics?.chartSeries ?? summary?.chartSeries ?? [],
    totalEarningsEur: summary?.totalEarningsEur ?? analytics?.totalEarningsEur,
    availableBalanceEur: summary?.availableBalanceEur ?? analytics?.availableBalanceEur,
    paidOutEur:
      summary?.paidOutEur ??
      analytics?.paidOutEur ??
      summary?.availableBalanceEur ??
      analytics?.availableBalanceEur,
    totalSupporters: summary?.totalSupporters ?? analytics?.totalSupporters,
  };
}

export function clearEmployeeTipsClientCache(timeframe?: "today" | "week" | "month"): void {
  if (timeframe) {
    for (const key of [...employeeTipsInflight.keys()]) {
      if (key.includes(`:${timeframe}`)) {
        employeeTipsInflight.delete(key);
      }
    }
    return;
  }
  employeeTipsInflight.clear();
}

export function clearEmployeeAccountClientCache(): void {
  for (const key of [...employeeTipsInflight.keys()]) {
    if (key.includes(":account:")) {
      employeeTipsInflight.delete(key);
    }
  }
}

export async function getEmployeeAccountSnapshot(
  init?: CaretipRequestInit & { silent?: boolean },
): Promise<EmployeeAccountSnapshot> {
  const data = await getTipsByEmployee("today", { ...init, scope: "account" });
  const paid =
    typeof data.paidOutEur === "number"
      ? data.paidOutEur
      : typeof data.availableBalanceEur === "number"
        ? data.availableBalanceEur
        : 0;
  return {
    totalEarningsEur: typeof data.totalEarningsEur === "number" ? data.totalEarningsEur : 0,
    availableBalanceEur: paid,
    paidOutEur: paid,
    totalSupporters: typeof data.totalSupporters === "number" ? data.totalSupporters : 0,
  };
}

export async function getTipsByEmployee(
  timeframe?: "today" | "week" | "month",
  init?: CaretipRequestInit & { silent?: boolean; scope?: EmployeeTipsScope },
): Promise<EmployeeTipsResponse> {
  const tf = timeframe ?? "today";
  const scope = init?.scope ?? "full";
  if (init?.signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
  const cacheKey = employeeTipsCacheKey(tf, scope);
  const inflight = employeeTipsInflight.get(cacheKey);
  const tipsUrl = apiPath(
    `/api/tips/employee?${new URLSearchParams({ timeframe: tf, scope }).toString()}`,
  );
  logDashboardTenantRequest("GET /api/tips/employee", { timeframe: tf, scope });
  if (inflight) {
    const target = resolveDashboardApiDebugTarget(tipsUrl);
    if (target) devTrackDeduped(target.group, target.key, { ...target.meta, inflight: true });
    return inflight;
  }

  const promise = apiRequest<EmployeeTipsResponse>(
    tipsUrl,
    {
      headers: getHeaders(),
      credentials: "include",
      signal: init?.signal,
      caretipSilentErrors: init?.silent === true,
    } as CaretipRequestInit,
  ).finally(() => {
    if (employeeTipsInflight.get(cacheKey) === promise) {
      employeeTipsInflight.delete(cacheKey);
    }
  });

  employeeTipsInflight.set(cacheKey, promise);
  return promise;
}

export interface EmployeeSelfAssignmentLocation {
  id: string;
  name: string;
  description: string | null;
}

export interface EmployeeSelfAssignmentTable {
  id: string;
  name: string;
  location: { id: string; name: string };
}

export interface EmployeeSelfAssignment {
  location: EmployeeSelfAssignmentLocation | null;
  tables: EmployeeSelfAssignmentTable[];
}

export interface EmployeeSelfProfile {
  id: string;
  name: string;
  email: string;
  jobTitle: string;
  bio: string | null;
  avatar: string | null;
  phone?: string | null;
  monthlyGoal: number | null;
  emailNotifications: boolean;
  pushNotifications: boolean;
  businessId: string;
  /** Public `Business.slug` for `/{businessSlug}/{employeeSlug}` URLs */
  businessSlug: string | null;
  /** Public URL for venue branding. */
  businessLogo: string | null;
  /** Venue display name. */
  businessName: string;
  /** Public /staff/[slug] segment */
  slug: string | null;
  /** Business IANA timezone for analytics reporting. */
  businessTimezone?: string;
  /** Venue SaaS tier for entitlement UI. Null when no subscription. */
  subscriptionTier?: "basic" | "premium" | "enterprise" | null;
  subscriptionStatus?: "none" | "trialing" | "active" | "past_due" | "canceled" | "unpaid" | "incomplete";
  hasActiveSubscription?: boolean;
  accessSource?: "none" | "subscription" | "sponsored";
  sponsoredProgrammeKey?: string | null;
  /** Manager-assigned venue location and tables (read-only for the employee). */
  assignment: EmployeeSelfAssignment;
}

const EMPLOYEE_PROFILE_CACHE_TTL_MS = 30_000;
let employeeProfileCache: { data: EmployeeSelfProfile; at: number } | null = null;
let employeeProfileInflight: Promise<EmployeeSelfProfile> | null = null;

export function clearEmployeeProfileClientCache(): void {
  employeeProfileCache = null;
  employeeProfileInflight = null;
}

function primeEmployeeSubscriptionTier(profile: EmployeeSelfProfile): void {
  const tier = resolveSubscriptionTier(profile.subscriptionTier);
  const accessSource = profile.accessSource ?? (profile.hasActiveSubscription ? "subscription" : "none");
  const status = profile.subscriptionStatus ?? (accessSource !== "none" ? "active" : "none");
  primeSubscriptionEntitlementsFromSession({ tier, status, accessSource });
  primeSubscriptionTierFromSession(tier ?? undefined);
}

export async function getEmployeeProfile(
  init?: CaretipRequestInit & { silent?: boolean },
): Promise<EmployeeSelfProfile> {
  const now = Date.now();
  if (employeeProfileCache && now - employeeProfileCache.at < EMPLOYEE_PROFILE_CACHE_TTL_MS) {
    primeEmployeeSubscriptionTier(employeeProfileCache.data);
    return employeeProfileCache.data;
  }
  if (employeeProfileInflight && !init?.signal) return employeeProfileInflight;

  const requestInit: CaretipRequestInit = {
    headers: getHeaders(),
    credentials: "include",
    signal: init?.signal ?? undefined,
    caretipSilentErrors: init?.silent === true || init?.caretipSilentErrors === true,
  };
  const promise = apiRequest<EmployeeSelfProfile>(apiPath("/api/employees/me"), requestInit).then((data) => {
    employeeProfileCache = { data, at: Date.now() };
    primeEmployeeSubscriptionTier(data);
    return data;
  });

  if (!init?.signal) {
    employeeProfileInflight = promise.finally(() => {
      employeeProfileInflight = null;
    });
    return employeeProfileInflight;
  }
  return promise;
}

/** Ensures a unique staff slug exists (for QR / public page). Safe to call when slug already set. */
export async function ensureEmployeeSlug(): Promise<EmployeeSelfProfile> {
  return apiRequest(apiPath("/api/employees/me/ensure-slug"), {
    method: "POST",
    headers: getHeaders(),
    body: EMPTY_JSON_BODY,
    credentials: "include",
  });
}

export async function patchEmployeeProfile(payload: {
  name?: string;
  bio?: string | null;
  phone?: string | null;
  monthlyGoal?: number | null;
  emailNotifications?: boolean;
  pushNotifications?: boolean;
}): Promise<EmployeeSelfProfile> {
  return apiRequest(apiPath("/api/employees/me"), {
    method: "PATCH",
    headers: getHeaders(),
    body: JSON.stringify(payload),
    credentials: "include",
  });
}

export async function uploadEmployeeAvatar(file: File): Promise<{ avatar: string }> {
  const check = validateImageFileForUpload(file);
  if (!check.ok) {
    throw new Error(toUserFriendlyMessage(new Error(check.message)));
  }
  const fd = new FormData();
  fd.append("avatar", file);
  return apiRequest<{ avatar: string }>(apiPath("/api/employees/me/avatar"), {
    method: "POST",
    headers: getAuthHeadersOnly(),
    body: fd,
    credentials: "include",
  });
}

export async function changePasswordAPI(currentPassword: string, newPassword: string): Promise<void> {
  await apiRequest(apiPath("/api/auth/change-password"), {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ currentPassword, newPassword }),
    credentials: "include",
  });
}

export type MyAccountSettings = {
  tipReceivedNotifications: boolean;
  summaryEmails: boolean;
  systemAlerts: boolean;
  notifyNewLogin: boolean;
  preferredLocale?: string | null;
};

export type FirebaseWebConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  vapidKey: string;
};

export async function fetchPushFirebaseConfig(): Promise<FirebaseWebConfig | null> {
  try {
    const res = await fetch(apiPath("/api/push/config"), {
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as FirebaseWebConfig;
  } catch (err) {
    if (!isApiConnectivityError(err)) {
      logClientError("api.fetchPushFirebaseConfig", err);
    }
    return null;
  }
}

export async function registerPushDeviceTokenApi(
  token: string,
  opts?: { silent?: boolean },
): Promise<void> {
  await apiRequest<void>(apiPath("/api/push/tokens"), {
    method: "POST",
    headers: getHeaders(),
    credentials: "include",
    body: JSON.stringify({ token }),
    caretipSilentErrors: opts?.silent === true,
  } as CaretipRequestInit);
}

export async function deletePushDeviceTokenApi(token: string): Promise<void> {
  await apiRequest<void>(apiPath("/api/push/tokens"), {
    method: "DELETE",
    headers: getHeaders(),
    credentials: "include",
    body: JSON.stringify({ token }),
  });
}

export async function deleteAllPushDeviceTokensApi(): Promise<void> {
  await apiRequest<void>(apiPath("/api/push/tokens/all"), {
    method: "DELETE",
    headers: getHeaders(),
    credentials: "include",
  });
}

export async function getMyAccountSettings(): Promise<MyAccountSettings> {
  return apiRequest(apiPath("/api/me/settings"), {
    method: "GET",
    headers: getHeaders(),
    credentials: "include",
  });
}

export async function patchMyAccountSettings(
  payload: Partial<MyAccountSettings> & { preferredLocale?: "en" | "de" | null },
): Promise<MyAccountSettings> {
  return apiRequest(apiPath("/api/me/settings"), {
    method: "PATCH",
    headers: getHeaders(),
    body: JSON.stringify(payload),
    credentials: "include",
  });
}

export type SubscriptionPlanKey = "basic" | "premium" | "enterprise";
export type SubscriptionBillingCycle = "monthly" | "yearly";
export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "incomplete";

export type BillingTimelineEvent = {
  id: string;
  auditType: string;
  occurredAt: string;
  processingResult: string;
  payload: Record<string, unknown> | null;
};

export type BillingStatus = {
  planKey: SubscriptionPlanKey | null;
  billingCycle: SubscriptionBillingCycle | null;
  status: SubscriptionStatus | "none";
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  isTrial: boolean;
  trialDaysRemaining: number | null;
  currentPeriodEnd: string | null;
  renewalDate: string | null;
  cancelAtPeriodEnd: boolean;
  cancellationEffective: string | null;
  hasStripeBilling: boolean;
  stripeCustomerId: string | null;
  subscriptionCreatedAt: string | null;
  syncedAt: string | null;
  subscriptionTier: SubscriptionPlanKey | null;
  billingEnabled: boolean;
  stripeConfigured: boolean;
  accessSource?: "none" | "subscription" | "sponsored";
  sponsoredProgrammeKey?: string | null;
  sponsoredProgrammeLabelKey?: string | null;
  trialEligible?: boolean;
  canStartTrial?: boolean;
  trialUsed?: boolean;
  trialPlanKey?: SubscriptionPlanKey | null;
  lastTrialPlanKey?: SubscriptionPlanKey | null;
  events: BillingTimelineEvent[];
};

export async function fetchBillingStatus(): Promise<BillingStatus> {
  return apiRequest<BillingStatus>(apiPath("/api/me/billing"), {
    method: "GET",
    headers: getHeaders(),
    credentials: "include",
  });
}

/** Stripe Connect Express status (Phase 1) — no account id / secrets. */
export type ConnectStatus = {
  status:
    | "not_connected"
    | "onboarding_required"
    | "onboarding_incomplete"
    | "requires_information"
    | "ready"
    | "restricted";
  stripeConfigured: boolean;
  hasAccount: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  requirementsDueCount: number;
  disabledReason: string | null;
  updatedAt: string | null;
  readyForPayouts: boolean;
};

export async function getConnectStatus(): Promise<ConnectStatus> {
  return apiRequest<ConnectStatus>(apiPath("/api/me/connect/status"), {
    method: "GET",
    headers: getHeaders(),
    credentials: "include",
  });
}

/** Starts/resumes Express onboarding — server creates Account Link; no client return URLs. */
export async function createConnectAccountLink(): Promise<{ url: string }> {
  return apiRequest(apiPath("/api/me/connect/account-link"), {
    method: "POST",
    headers: getHeaders(),
    credentials: "include",
    body: JSON.stringify({}),
  });
}

export type ConnectPayoutStatus =
  | "pending"
  | "in_transit"
  | "paid"
  | "failed"
  | "canceled"
  | "unknown";

export type ConnectPayoutReconciliationStatus =
  | "pending"
  | "in_progress"
  | "complete"
  | "partial"
  | "failed";

export type ConnectPayoutBalanceLine = {
  reportingCategory: string | null;
  type: string;
  amountCents: number;
  feeCents: number;
  netCents: number;
  amountEur: number;
  netEur: number;
  currency: string;
};

export type ConnectPayout = {
  id: string;
  amountCents: number;
  amountEur: number;
  currency: string;
  status: ConnectPayoutStatus;
  arrivalDate: string | null;
  method: string | null;
  payoutType: string | null;
  description: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: string;
  stripeCreatedAt: string;
  paidAt: string | null;
  failedAt: string | null;
  canceledAt: string | null;
  reconciliationStatus: ConnectPayoutReconciliationStatus;
  balanceLineCount: number;
  balanceLines?: ConnectPayoutBalanceLine[];
};

export type PlatformConnectPayout = ConnectPayout & {
  businessId: string;
  businessName: string;
  stripeAccountSuffix: string;
};

export async function listMyConnectPayouts(params?: {
  take?: number;
  skip?: number;
}): Promise<{ items: ConnectPayout[]; total: number }> {
  const sp = new URLSearchParams();
  if (params?.take != null) sp.set("take", String(params.take));
  if (params?.skip != null) sp.set("skip", String(params.skip));
  const qs = sp.toString();
  return apiRequest<{ items: ConnectPayout[]; total: number }>(
    apiPath(`/api/me/connect/payouts${qs ? `?${qs}` : ""}`),
    { method: "GET", headers: getHeaders(), credentials: "include" },
  );
}

export async function getMyConnectPayout(id: string): Promise<ConnectPayout> {
  return apiRequest<ConnectPayout>(apiPath(`/api/me/connect/payouts/${encodeURIComponent(id)}`), {
    method: "GET",
    headers: getHeaders(),
    credentials: "include",
  });
}

export async function fetchPlatformConnectPayout(id: string): Promise<PlatformConnectPayout> {
  return apiRequest<PlatformConnectPayout>(
    apiPath(`/api/platform/connect-payouts/${encodeURIComponent(id)}`),
    { method: "GET", headers: getHeaders(), credentials: "include" },
  );
}

export async function fetchPlatformConnectPayouts(params: {
  q?: string;
  take?: number;
  skip?: number;
  status?: string;
  reconciliationStatus?: string;
  currency?: string;
  createdFrom?: string;
  createdTo?: string;
  businessId?: string;
}): Promise<{ items: PlatformConnectPayout[]; total: number }> {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.status) sp.set("status", params.status);
  if (params.reconciliationStatus) sp.set("reconciliationStatus", params.reconciliationStatus);
  if (params.currency) sp.set("currency", params.currency);
  if (params.createdFrom) sp.set("createdFrom", params.createdFrom);
  if (params.createdTo) sp.set("createdTo", params.createdTo);
  if (params.businessId) sp.set("businessId", params.businessId);
  if (params.take != null) sp.set("take", String(params.take));
  if (params.skip != null) sp.set("skip", String(params.skip));
  const qs = sp.toString();
  return apiRequest(apiPath(`/api/platform/connect-payouts${qs ? `?${qs}` : ""}`), {
    headers: getHeaders(),
    credentials: "include",
  });
}

export async function createBillingCheckoutSession(params: {
  planKey: SubscriptionPlanKey;
  billingCycle?: SubscriptionBillingCycle;
  includeTrial?: boolean;
  /** billing = dashboard upgrade (default); onboarding = pricing → signup flow */
  checkoutFlow?: "billing" | "onboarding";
}): Promise<{ sessionId: string; url: string | null }> {
  return apiRequest(apiPath("/api/me/billing/checkout"), {
    method: "POST",
    headers: getHeaders(),
    credentials: "include",
    body: JSON.stringify(params),
  });
}

export type BillingSyncStatus = {
  synced: boolean;
  status: SubscriptionStatus | "none" | null;
  planKey: SubscriptionPlanKey | null;
  subscriptionTier: SubscriptionPlanKey | null;
  isTrial: boolean;
  hasStripeBilling: boolean;
};

export async function fetchBillingSyncStatus(
  expectedPlan?: SubscriptionPlanKey,
): Promise<BillingSyncStatus> {
  const qs = expectedPlan ? `?expectedPlan=${encodeURIComponent(expectedPlan)}` : "";
  return apiRequest<BillingSyncStatus>(apiPath(`/api/me/billing/sync-status${qs}`), {
    method: "GET",
    headers: getHeaders(),
    credentials: "include",
  });
}

export async function createBillingPortalSession(opts?: {
  flow?: "default" | "payment_methods";
}): Promise<{ url: string }> {
  const body =
    opts?.flow === "payment_methods" ? { flow: "payment_methods" as const } : {};
  return apiRequest(apiPath("/api/me/billing/portal"), {
    method: "POST",
    headers: getHeaders(),
    credentials: "include",
    body: JSON.stringify(body),
  });
}

/** Mobile app → web billing session handoff (one-time token redeem). */
export type MobileWebHandoffConsumeResponse = AuthResponse & {
  destinationPath: string;
  purpose: string;
};

export async function consumeMobileWebHandoff(
  token: string,
): Promise<MobileWebHandoffConsumeResponse> {
  return apiRequest<MobileWebHandoffConsumeResponse>(
    apiPath("/api/auth/mobile-web-handoff/consume"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: token.trim() }),
      credentials: "include",
    },
  );
}

export async function scheduleBillingCancelAtPeriodEnd(): Promise<{
  status: string;
  cancelAtPeriodEnd: boolean;
  cancellationEffective: string | null;
}> {
  return apiRequest(apiPath("/api/me/billing/cancel"), {
    method: "POST",
    headers: getHeaders(),
    credentials: "include",
    body: JSON.stringify({ atPeriodEnd: true }),
  });
}

export type InboxNotification = {
  id: string;
  type: string;
  title: string;
  message: string;
  metadata: Record<string, unknown>;
  priority: "normal" | "high";
  channels: string[];
  read: boolean;
  readAt: string | null;
  createdAt: string;
  url: string | null;
};

export type NotificationsListResponse = {
  items: InboxNotification[];
  nextCursor: string | null;
  unreadCount: number;
};

const notificationsListInflight = new Map<string, Promise<NotificationsListResponse>>();

export async function fetchMyNotifications(params?: {
  limit?: number;
  cursor?: string;
  unreadOnly?: boolean;
  kind?: "support" | "other";
  q?: string;
  supportStatus?: string;
  /** UI locale for server-side template rendering (`en` | `de`). */
  locale?: "en" | "de";
}): Promise<NotificationsListResponse> {
  const q = new URLSearchParams();
  if (params?.limit) q.set("limit", String(params.limit));
  if (params?.cursor) q.set("cursor", params.cursor);
  if (params?.unreadOnly) q.set("unreadOnly", "true");
  if (params?.kind) q.set("kind", params.kind);
  if (params?.q?.trim()) q.set("q", params.q.trim());
  if (params?.supportStatus?.trim()) q.set("supportStatus", params.supportStatus.trim());
  if (params?.locale) q.set("locale", params.locale);
  const suffix = q.toString() ? `?${q.toString()}` : "";
  const cacheKey = suffix || "default";

  const existing = notificationsListInflight.get(cacheKey);
  if (existing) return existing;

  const promise = (async (): Promise<NotificationsListResponse> => {
    const raw = await apiRequest<
      NotificationsListResponse & { notifications?: InboxNotification[] }
    >(apiPath(`/api/me/notifications${suffix}`), {
      method: "GET",
      headers: getHeaders(),
      credentials: "include",
      caretipSilentErrors: true,
    } as CaretipRequestInit);
    const items = Array.isArray(raw.items)
      ? raw.items
      : Array.isArray(raw.notifications)
        ? raw.notifications
        : [];
    return {
      items,
      nextCursor: raw.nextCursor ?? null,
      unreadCount: typeof raw.unreadCount === "number" ? raw.unreadCount : 0,
    };
  })().finally(() => {
    if (notificationsListInflight.get(cacheKey) === promise) {
      notificationsListInflight.delete(cacheKey);
    }
  });

  notificationsListInflight.set(cacheKey, promise);
  return promise;
}

const UNREAD_COUNT_CACHE_MS = 3_000;
let unreadCountInflight: Promise<{ unreadCount: number }> | null = null;
let unreadCountCache: { at: number; data: { unreadCount: number } } | null = null;

export function invalidateUnreadNotificationCountCache(): void {
  unreadCountCache = null;
}

export async function fetchMyUnreadNotificationCount(): Promise<{ unreadCount: number }> {
  const now = Date.now();
  if (unreadCountCache && now - unreadCountCache.at < UNREAD_COUNT_CACHE_MS) {
    return unreadCountCache.data;
  }
  if (unreadCountInflight) return unreadCountInflight;
  const promise = apiRequest<{ unreadCount: number }>(apiPath("/api/me/notifications/unread-count"), {
    method: "GET",
    headers: getHeaders(),
    credentials: "include",
    caretipSilentErrors: true,
  } as CaretipRequestInit)
    .then((data) => {
      unreadCountCache = { at: Date.now(), data };
      return data;
    })
    .finally(() => {
      if (unreadCountInflight === promise) unreadCountInflight = null;
    });
  unreadCountInflight = promise;
  return promise;
}

export async function markNotificationReadApi(
  id: string,
  locale?: "en" | "de",
): Promise<{ notification: InboxNotification; unreadCount: number }> {
  const suffix = locale ? `?locale=${locale}` : "";
  const res = await apiRequest<{ notification: InboxNotification; unreadCount: number }>(
    apiPath(`/api/me/notifications/${id}/read${suffix}`),
    {
      method: "PATCH",
      headers: getHeaders(),
      credentials: "include",
    },
  );
  invalidateUnreadNotificationCountCache();
  return res;
}

export async function markAllNotificationsReadApi(): Promise<{ updated: number; unreadCount: number }> {
  const res = await apiRequest<{ updated: number; unreadCount: number }>(
    apiPath("/api/me/notifications/read-all"),
    {
      method: "POST",
      headers: getHeaders(),
      credentials: "include",
    },
  );
  invalidateUnreadNotificationCountCache();
  return res;
}

export type SetupPromptKind =
  | "stripe_connect"
  | "missing_employee_qr"
  | "onboarding_verification"
  | "profile_photo";

export type SetupPromptEvaluateItem = {
  kind: SetupPromptKind;
  conditionActive: boolean;
  conditionVersion: string;
};

export type SetupPromptVisibilityResult = {
  kind: SetupPromptKind;
  show: boolean;
  status: string;
  remindAt: string | null;
};

export async function evaluateSetupPromptsApi(
  items: SetupPromptEvaluateItem[],
): Promise<SetupPromptVisibilityResult[]> {
  const res = await apiRequest<{ results: SetupPromptVisibilityResult[] }>(
    apiPath("/api/me/notifications/setup/evaluate"),
    {
      method: "POST",
      headers: getHeaders(),
      credentials: "include",
      body: JSON.stringify({ items }),
      caretipSilentErrors: true,
    } as CaretipRequestInit,
  );
  return Array.isArray(res.results) ? res.results : [];
}

export async function dismissSetupPromptApi(
  kind: SetupPromptKind,
  conditionVersion: string,
): Promise<SetupPromptVisibilityResult> {
  const res = await apiRequest<{ result: SetupPromptVisibilityResult }>(
    apiPath("/api/me/notifications/setup/dismiss"),
    {
      method: "POST",
      headers: getHeaders(),
      credentials: "include",
      body: JSON.stringify({ kind, conditionVersion }),
    },
  );
  return res.result;
}

export async function actionSetupPromptApi(
  kind: SetupPromptKind,
  conditionVersion: string,
): Promise<SetupPromptVisibilityResult> {
  const res = await apiRequest<{ result: SetupPromptVisibilityResult }>(
    apiPath("/api/me/notifications/setup/actioned"),
    {
      method: "POST",
      headers: getHeaders(),
      credentials: "include",
      body: JSON.stringify({ kind, conditionVersion }),
    },
  );
  return res.result;
}


export async function deleteNotificationApi(id: string): Promise<{ success: boolean; unreadCount: number }> {
  const res = await apiRequest<{ success: boolean; unreadCount: number }>(
    apiPath(`/api/me/notifications/${encodeURIComponent(id)}`),
    {
      method: "DELETE",
      headers: getHeaders(),
      credentials: "include",
    },
  );
  invalidateUnreadNotificationCountCache();
  return res;
}

export type SupportTicketCategory =
  | "technical"
  | "billing"
  | "kyc"
  | "feature_request"
  | "general";

export type SupportTicketStatus = "OPEN" | "PENDING" | "RESOLVED" | "CLOSED";

export type SupportTicketSummary = {
  id: string;
  ticketNumber: string;
  businessId: string;
  businessName: string;
  subject: string;
  category: SupportTicketCategory;
  status: SupportTicketStatus;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  messageCount: number;
  lastMessagePreview: string | null;
};

export type SupportTicketMessage = {
  id: string;
  authorUserId: string;
  authorRole: "business" | "admin";
  body: string;
  createdAt: string;
};

export type SupportTicketDetail = SupportTicketSummary & {
  messages: SupportTicketMessage[];
};

export async function createBusinessSupportTicket(input: {
  subject: string;
  category: SupportTicketCategory;
  message: string;
}): Promise<{ ticket: SupportTicketDetail }> {
  return apiRequest(apiPath("/api/business/support/tickets"), {
    method: "POST",
    headers: getHeaders(),
    credentials: "include",
    body: JSON.stringify(input),
  });
}

export async function fetchBusinessSupportTickets(params?: {
  status?: SupportTicketStatus;
  search?: string;
}): Promise<{ tickets: SupportTicketSummary[] }> {
  const q = new URLSearchParams();
  if (params?.status) q.set("status", params.status);
  if (params?.search?.trim()) q.set("search", params.search.trim());
  const suffix = q.toString() ? `?${q.toString()}` : "";
  return apiRequest(apiPath(`/api/business/support/tickets${suffix}`), {
    method: "GET",
    headers: getHeaders(),
    credentials: "include",
  });
}

export async function fetchBusinessSupportTicket(
  ticketId: string,
): Promise<{ ticket: SupportTicketDetail }> {
  return apiRequest(apiPath(`/api/business/support/tickets/${ticketId}`), {
    method: "GET",
    headers: getHeaders(),
    credentials: "include",
  });
}

export async function replyBusinessSupportTicket(
  ticketId: string,
  body: string,
): Promise<{ ticket: SupportTicketDetail }> {
  return apiRequest(apiPath(`/api/business/support/tickets/${ticketId}/messages`), {
    method: "POST",
    headers: getHeaders(),
    credentials: "include",
    body: JSON.stringify({ body }),
  });
}

export async function fetchPlatformSupportTickets(params?: {
  status?: SupportTicketStatus;
  category?: SupportTicketCategory;
  search?: string;
}): Promise<{ tickets: SupportTicketSummary[] }> {
  const q = new URLSearchParams();
  if (params?.status) q.set("status", params.status);
  if (params?.category) q.set("category", params.category);
  if (params?.search?.trim()) q.set("search", params.search.trim());
  const suffix = q.toString() ? `?${q.toString()}` : "";
  return apiRequest(apiPath(`/api/platform/support/tickets${suffix}`), {
    method: "GET",
    headers: getHeaders(),
    credentials: "include",
  });
}

export async function fetchPlatformSupportTicket(
  ticketId: string,
): Promise<{ ticket: SupportTicketDetail }> {
  return apiRequest(apiPath(`/api/platform/support/tickets/${ticketId}`), {
    method: "GET",
    headers: getHeaders(),
    credentials: "include",
  });
}

export async function replyPlatformSupportTicket(
  ticketId: string,
  body: string,
): Promise<{ ticket: SupportTicketDetail }> {
  return apiRequest(apiPath(`/api/platform/support/tickets/${ticketId}/messages`), {
    method: "POST",
    headers: getHeaders(),
    credentials: "include",
    body: JSON.stringify({ body }),
  });
}

export async function updatePlatformSupportTicketStatus(
  ticketId: string,
  status: SupportTicketStatus,
): Promise<{ ticket: SupportTicketDetail }> {
  return apiRequest(apiPath(`/api/platform/support/tickets/${ticketId}/status`), {
    method: "PATCH",
    headers: getHeaders(),
    credentials: "include",
    body: JSON.stringify({ status }),
  });
}

export const SUPPORT_TICKET_NOTIFICATION_TYPES = [
  "support_ticket_created",
  "support_ticket_reply",
  "support_ticket_status",
] as const;

export function isSupportTicketNotification(type: string): boolean {
  return (SUPPORT_TICKET_NOTIFICATION_TYPES as readonly string[]).includes(type);
}

export type PlatformAnnouncementRow = {
  id: string;
  title: string;
  message: string;
  audience: string;
  priority: string;
  channels: string[];
  url: string | null;
  recipientCount: number;
  createdByEmail: string;
  createdAt: string;
};

export async function fetchPlatformAnnouncements(params: {
  take?: number;
  skip?: number;
}): Promise<{ items: PlatformAnnouncementRow[]; total: number }> {
  const sp = new URLSearchParams();
  if (params.take != null) sp.set("take", String(params.take));
  if (params.skip != null) sp.set("skip", String(params.skip));
  const qs = sp.toString();
  return apiRequest(apiPath(`/api/platform/announcements${qs ? `?${qs}` : ""}`), {
    headers: getHeaders(),
    credentials: "include",
  });
}

export async function sendPlatformAnnouncementApi(payload: {
  title: string;
  message: string;
  audience: "all" | "managers" | "employees" | "admins";
  url?: string;
  priority?: "normal" | "high";
  channels?: { inApp?: boolean; push?: boolean; email?: boolean };
}): Promise<{ success: boolean; recipientCount: number; announcementId: string; message: string }> {
  return apiRequest(apiPath("/api/platform/announcements"), {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      title: payload.title,
      message: payload.message,
      audience: payload.audience,
      url: payload.url,
      priority: payload.priority ?? "normal",
      channels: {
        inApp: payload.channels?.inApp !== false,
        push: payload.channels?.push !== false,
        email: payload.channels?.email === true,
      },
    }),
    credentials: "include",
  });
}

export async function getTwoFactorStatus(): Promise<{ enabled: boolean }> {
  return apiRequest(apiPath("/api/auth/2fa/status"), {
    method: "GET",
    headers: getHeaders(),
    credentials: "include",
  });
}

export async function setupTwoFactor(): Promise<{ otpauthUrl: string; qrDataUrl: string }> {
  return apiRequest(apiPath("/api/auth/2fa/setup"), {
    method: "POST",
    headers: getHeaders(),
    body: EMPTY_JSON_BODY,
    credentials: "include",
  });
}

export async function enableTwoFactor(code: string): Promise<{ enabled: boolean }> {
  return apiRequest(apiPath("/api/auth/2fa/enable"), {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ code }),
    credentials: "include",
  });
}

export async function disableTwoFactor(code: string): Promise<{ enabled: boolean }> {
  return apiRequest(apiPath("/api/auth/2fa/disable"), {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ code }),
    credentials: "include",
  });
}

export async function downloadMyDataExport(): Promise<void> {
  const token = getToken();
  const res = await fetch(apiPath("/api/employees/me/export"), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: "include",
  });
  if (!res.ok) {
    const ct = res.headers.get("content-type") ?? "";
    let errData: unknown = {};
    if (ct.includes("application/json")) {
      errData = await res.json().catch(() => ({}));
    } else {
      const text = await res.text().catch(() => "");
      errData = text.trim() ? { message: text.trim().slice(0, 300) } : {};
    }
    logClientError("api.downloadMyDataExport", new Error(`HTTP ${res.status}`), {
      status: res.status,
      body: errData,
    });
    throw new Error(toUserFriendlyMessage(new Error("Could not download your data.")));
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `caretip-my-data-${new Date().toISOString().slice(0, 10)}.json`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function deleteMyEmployeeAccount(): Promise<void> {
  await apiRequest<void>(apiPath("/api/employees/me"), {
    method: "DELETE",
    headers: getHeaders(),
    credentials: "include",
  });
}

export interface TippingContextResponse {
  locationName: string;
  tableName: string;
  businessId: string;
  locationId: string;
  tableId: string;
  businessName: string;
  businessLogo?: string | null;
  branding?: import("./businessBranding").PublicGuestBranding | null;
}

/** Scan types aligned with backend QR_SCAN_TYPES. */
export type GuestQrScanType =
  | "employee"
  | "employee_legacy_slug"
  | "employee_legacy_id"
  | "business_directory"
  | "business_id"
  | "location"
  | "table_id"
  | "table_slug";

export type RecordGuestQrScanParams = {
  businessId: string;
  scanType: GuestQrScanType;
  employeeId?: string;
  locationId?: string;
  tableId?: string;
  qrSlug?: string;
  entryPath?: string;
  notify?: {
    locationName?: string;
    tableName?: string;
  };
};

export type RecordGuestQrScanResult = {
  inserted: boolean;
  scanId: string | null;
  visitId: string | null;
  visitStatus: string | null;
};

const guestScanRecordedKeys = new Set<string>();

function guestScanClientKey(businessId: string): string {
  return `${getOrCreateQrScanSessionId()}:${businessId}`;
}

/** Phase 3 — sole client entry for durable QR scan analytics (POST /api/qr/scan). */
export async function recordGuestQrScan(
  params: RecordGuestQrScanParams,
): Promise<RecordGuestQrScanResult | null> {
  const clientKey = guestScanClientKey(params.businessId);
  if (guestScanRecordedKeys.has(clientKey)) return null;
  guestScanRecordedKeys.add(clientKey);
  try {
    return await apiRequest<RecordGuestQrScanResult>(apiPath("/api/qr/scan"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...guestQrScanHeaders(),
      },
      body: JSON.stringify(params),
    });
  } catch (e) {
    guestScanRecordedKeys.delete(clientKey);
    logClientError("recordGuestQrScan", e);
    return null;
  }
}

/** Fire-and-forget — never blocks landing UI. */
export function recordGuestQrScanOnce(params: RecordGuestQrScanParams): void {
  void recordGuestQrScan(params);
}

/** Public: resolve table QR slug to venue + business (guest scan). */
export async function getTippingContextByQrSlug(qrSlug: string): Promise<TippingContextResponse> {
  return apiRequest<TippingContextResponse>(
    apiPath(`/api/tipping-context/${encodeURIComponent(qrSlug)}`),
    { method: "GET", headers: guestQrScanHeaders() }
  );
}

/** Public: venue/location QR — team list for the business at this location. */
export interface PublicLocationContextResponse {
  business: { id: string; name: string; slug: string | null; logo?: string | null };
  location: { id: string; name: string; description: string | null };
  employees: BusinessDirectoryEmployee[];
}

export async function getPublicLocationContext(
  locationId: string
): Promise<PublicLocationContextResponse> {
  return apiRequest<PublicLocationContextResponse>(
    apiPath(`/api/tipping-context/location/${encodeURIComponent(locationId)}`),
    { method: "GET", headers: guestQrScanHeaders() }
  );
}

/** Public: table QR by table id — same team list + table/location labels for tip metadata. */
export interface PublicTableContextResponse {
  business: { id: string; name: string; slug: string | null; logo?: string | null };
  location: { id: string; name: string };
  table: { id: string; name: string; qrSlug: string };
  employees: BusinessDirectoryEmployee[];
}

export async function getPublicTableContextById(
  tableId: string
): Promise<PublicTableContextResponse> {
  return apiRequest<PublicTableContextResponse>(
    apiPath(`/api/tipping-context/table/${encodeURIComponent(tableId)}`),
    { method: "GET", headers: guestQrScanHeaders() }
  );
}

export interface LocationDTO {
  id: string;
  name: string;
  description: string | null;
  businessId: string;
}

export async function fetchLocations(): Promise<LocationDTO[]> {
  const raw = await apiRequest<unknown>(apiPath("/api/locations"), {
    headers: getHeaders(),
    credentials: "include",
  });
  return normalizeApiList<LocationDTO>(raw, ["locations", "items", "data"]);
}

export async function createLocationAPI(payload: {
  name: string;
  description?: string;
}): Promise<LocationDTO> {
  return apiRequest<LocationDTO>(apiPath("/api/locations"), {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(payload),
    credentials: "include",
  });
}

export async function updateLocationAPI(
  locationId: string,
  payload: { name: string; description?: string | null },
): Promise<LocationDTO> {
  return apiRequest<LocationDTO>(apiPath(`/api/locations/${encodeURIComponent(locationId)}`), {
    method: "PATCH",
    headers: getHeaders(),
    body: JSON.stringify(payload),
    credentials: "include",
  });
}

export async function deleteLocationAPI(locationId: string): Promise<void> {
  await apiRequest<void>(apiPath(`/api/locations/${encodeURIComponent(locationId)}`), {
    method: "DELETE",
    headers: getHeaders(),
    credentials: "include",
  });
}

export interface TableDTO {
  id: string;
  name: string;
  qrSlug: string;
  locationId: string;
  location: { id: string; name: string };
}

export async function fetchTables(opts?: { silent?: boolean }): Promise<TableDTO[]> {
  const raw = await apiRequest<unknown>(apiPath("/api/tables"), {
    headers: getHeaders(),
    credentials: "include",
    caretipSilentErrors: opts?.silent === true,
  } as CaretipRequestInit);
  return normalizeApiList<TableDTO>(raw, ["tables", "items", "data"]);
}

export type PhysicalQrCatalogProduct = {
  id: string;
  name: string;
  description: string;
  templateId: string;
  supportsAddress: boolean;
  active: boolean;
  orderable: boolean;
  currency: string;
  priceCents: number | null;
  priceConfigured: boolean;
  checkoutReady: boolean;
  checkoutBlock: string | null;
};

export type PhysicalQrContextOption = {
  id: string;
  label: string;
  locationId?: string | null;
  isPrimary?: boolean;
};

export type PhysicalQrContextOptions = {
  storefront: PhysicalQrContextOption;
  employees: PhysicalQrContextOption[];
  locations: PhysicalQrContextOption[];
  tables: PhysicalQrContextOption[];
  primaryLocationId?: string | null;
  freeOrderAvailable?: boolean;
};

export type PhysicalQrOrderItem = {
  id: string;
  productId: string;
  productName: string | null;
  templateId: string | null;
  supportsAddress: boolean;
  qrContextType: string;
  qrSubjectId: string | null;
  label: string;
  locationId?: string | null;
  locationName?: string | null;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  addressSnapshot: unknown;
  colorTokensSnapshot: unknown;
};

export type PhysicalQrCustomerOrder = {
  id: string;
  productId: string;
  productName: string | null;
  templateId: string | null;
  supportsAddress: boolean;
  qrContextType: string;
  qrSubjectId: string | null;
  quantity: number;
  itemCount: number;
  items: PhysicalQrOrderItem[];
  currency: string;
  unitPrice: number;
  totalAmount: number;
  pricing?: {
    printCount?: number;
    freeOrderApplied?: boolean;
    includedPrints?: number;
    extraPrints?: number;
    extraUnitCents?: number;
    packageCents?: number;
    extraCents?: number;
    totalCents?: number;
  } | null;
  monthlyFreeQuotaApplied?: boolean;
  placedAt: string;
  processingClass: string;
  processingDeadlineAt: string;
  processingCopySnapshot: unknown;
  addressSnapshot: unknown;
  shippingSnapshot?: unknown;
  contactSnapshot?: unknown;
  colorTokensSnapshot?: unknown;
  businessNameSnapshot: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  canPay: boolean;
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  paidAt: string | null;
  processingAt: string | null;
  printingAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
};

export type PhysicalQrInternalNote = {
  id: string;
  body: string;
  authorName: string;
  createdAt: string;
};

export async function fetchPhysicalQrCatalog(): Promise<{ products: PhysicalQrCatalogProduct[] }> {
  return apiRequest(apiPath("/api/business/physical-qr/catalog"), {
    headers: getHeaders(),
    credentials: "include",
  });
}

export async function quotePhysicalQrCart(payload: {
  lineItems: Array<{
    productId: string;
    qrContextType: string;
    qrSubjectId?: string;
    quantity: number;
  }>;
}): Promise<{
  quote: {
    printCount: number;
    freeOrderApplied: boolean;
    includedPrints: number;
    extraPrints: number;
    extraUnitCents: number;
    packageCents: number;
    extraCents: number;
    totalCents: number;
  };
  freeOrderAvailable: boolean;
  primaryLocationId: string | null;
}> {
  return apiRequest(apiPath("/api/business/physical-qr/quote"), {
    method: "POST",
    headers: getHeaders(),
    credentials: "include",
    body: JSON.stringify(payload),
  });
}

export async function fetchPhysicalQrContexts(): Promise<PhysicalQrContextOptions> {
  return apiRequest(apiPath("/api/business/physical-qr/contexts"), {
    headers: getHeaders(),
    credentials: "include",
  });
}

export async function resolvePhysicalQrContext(payload: {
  qrContextType: string;
  qrSubjectId?: string;
}): Promise<{ qrTargetUrl: string; qrContextType: string; qrSubjectId: string | null; label: string }> {
  return apiRequest(apiPath("/api/business/physical-qr/contexts/resolve"), {
    method: "POST",
    headers: getHeaders(),
    credentials: "include",
    body: JSON.stringify(payload),
  });
}

export async function fetchPhysicalQrOrders(): Promise<{ orders: PhysicalQrCustomerOrder[] }> {
  return apiRequest(apiPath("/api/business/physical-qr/orders"), {
    headers: getHeaders(),
    credentials: "include",
  });
}

export async function fetchPhysicalQrOrder(orderId: string): Promise<PhysicalQrCustomerOrder> {
  return apiRequest(apiPath(`/api/business/physical-qr/orders/${encodeURIComponent(orderId)}`), {
    headers: getHeaders(),
    credentials: "include",
  });
}

export async function createPhysicalQrOrder(payload: {
  productId: string;
  qrContextType: string;
  qrSubjectId?: string;
  quantity: number;
  address?: string;
  shipping: {
    recipientName: string;
    streetLine: string;
    addressLine2?: string;
    postalCode: string;
    city: string;
    country: string;
  };
  contact: {
    name: string;
    email: string;
    phone: string;
  };
  colorTokens: {
    backgroundGradientStart: string;
    backgroundGradientEnd: string;
    primaryTextColor: string;
    secondaryTextColor: string;
  };
}): Promise<PhysicalQrCustomerOrder> {
  return apiRequest(apiPath("/api/business/physical-qr/orders"), {
    method: "POST",
    headers: getHeaders(),
    credentials: "include",
    body: JSON.stringify(payload),
  });
}

export async function checkoutPhysicalQrOrder(
  orderId: string,
): Promise<{ url: string; sessionId: string }> {
  return apiRequest(apiPath(`/api/business/physical-qr/orders/${encodeURIComponent(orderId)}/checkout`), {
    method: "POST",
    headers: getHeaders(),
    credentials: "include",
    body: EMPTY_JSON_BODY,
  });
}

export async function createPhysicalQrBatch(payload: {
  lineItems: Array<{
    productId: string;
    qrContextType: string;
    qrSubjectId?: string;
    quantity?: number;
  }>;
  address?: string;
  shipping: {
    recipientName: string;
    streetLine: string;
    addressLine2?: string;
    postalCode: string;
    city: string;
    country: string;
  };
  contact: {
    name: string;
    email: string;
    phone: string;
  };
  colorTokens: {
    backgroundGradientStart: string;
    backgroundGradientEnd: string;
    primaryTextColor: string;
    secondaryTextColor: string;
  };
}): Promise<{ order: PhysicalQrCustomerOrder }> {
  return apiRequest(apiPath("/api/business/physical-qr/orders/batch"), {
    method: "POST",
    headers: getHeaders(),
    credentials: "include",
    body: JSON.stringify(payload),
  });
}

export async function checkoutPhysicalQrBatch(
  orderId: string,
): Promise<{ url: string; sessionId: string | null; zeroCost?: boolean }> {
  return apiRequest(apiPath("/api/business/physical-qr/orders/batch/checkout"), {
    method: "POST",
    headers: getHeaders(),
    credentials: "include",
    body: JSON.stringify({ orderId }),
  });
}

export type PhysicalQrAdminOrder = {
  id: string;
  businessId: string;
  businessName: string | null;
  businessSlug: string | null;
  productName: string | null;
  supportsAddress: boolean;
  qrContextType: string;
  quantity: number;
  itemCount: number;
  items: PhysicalQrOrderItem[];
  paymentStatus: string;
  fulfillmentStatus: string;
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  paidAt: string | null;
  processingAt: string | null;
  printingAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  placedAt: string;
  updatedAt: string | null;
  currency: string;
  unitPrice: number;
  totalAmount: number;
  processingClass: string | null;
  processingCopySnapshot: unknown;
  addressSnapshot: unknown;
  shippingSnapshot?: unknown;
  contactSnapshot?: unknown;
  qrTargetUrlSnapshot?: string | null;
  stripePaymentIntentId?: string | null;
  businessNameSnapshot: string | null;
};

export async function fetchPlatformPhysicalQrOrders(params?: {
  filter?: string;
  q?: string;
}): Promise<{ orders: PhysicalQrAdminOrder[] }> {
  const search = new URLSearchParams();
  if (params?.filter) search.set("filter", params.filter);
  if (params?.q) search.set("q", params.q);
  const qs = search.toString();
  return apiRequest(apiPath(`/api/platform/physical-qr/orders${qs ? `?${qs}` : ""}`), {
    headers: getHeaders(),
    credentials: "include",
  });
}

export async function fetchPlatformPhysicalQrOrder(orderId: string): Promise<{
  order: PhysicalQrAdminOrder;
  internalNotes: PhysicalQrInternalNote[];
}> {
  return apiRequest(apiPath(`/api/platform/physical-qr/orders/${encodeURIComponent(orderId)}`), {
    headers: getHeaders(),
    credentials: "include",
  });
}

export async function markPlatformPhysicalQrPrinting(orderId: string): Promise<PhysicalQrAdminOrder> {
  return apiRequest(apiPath(`/api/platform/physical-qr/orders/${encodeURIComponent(orderId)}/printing`), {
    method: "POST",
    headers: getHeaders(),
    credentials: "include",
    body: EMPTY_JSON_BODY,
  });
}

export async function downloadPlatformPhysicalQrOrderPrint(
  orderId: string,
  format: "pdf" | "png" = "pdf",
  itemId?: string,
): Promise<void> {
  const token = getToken();
  const params = new URLSearchParams();
  params.set("format", format);
  if (itemId) params.set("itemId", itemId);
  const qs = `?${params.toString()}`;
  const res = await fetch(
    apiPath(`/api/platform/physical-qr/orders/${encodeURIComponent(orderId)}/print${qs}`),
    {
      method: "GET",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: "include",
    },
  );
  if (!res.ok) {
    const ct = res.headers.get("content-type") ?? "";
    let message = "Could not download the print file.";
    if (ct.includes("application/json")) {
      const errData = (await res.json().catch(() => ({}))) as { message?: string; code?: string };
      if (errData.code === "PAYMENT_REQUIRED" || res.status === 409) {
        message = "Print files are available after payment is confirmed.";
      } else if (errData.code === "PRINT_TOO_LARGE" || res.status === 413) {
        message = errData.message || "Combined PDF is too large. Download line items individually.";
      } else if (errData.message) {
        message = errData.message;
      }
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download =
    format === "png" ? `caretip-a5-${orderId}.png` : `caretip-a5-${orderId}.pdf`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function downloadPlatformPhysicalQrOrdersZip(orderIds: string[]): Promise<{
  prepared: number;
  failed: number;
  requested: number;
}> {
  const token = getToken();
  const res = await fetch(apiPath("/api/platform/physical-qr/orders/print-bulk"), {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({ orderIds }),
  });
  if (!res.ok) {
    const ct = res.headers.get("content-type") ?? "";
    let message = "Unable to download PDFs. Try again.";
    if (ct.includes("application/json")) {
      const errData = (await res.json().catch(() => ({}))) as { message?: string };
      if (errData.message) message = errData.message;
    }
    throw new Error(message);
  }
  const prepared = Number(res.headers.get("X-CareTip-Print-Prepared") ?? "0");
  const failed = Number(res.headers.get("X-CareTip-Print-Failed") ?? "0");
  const requested = Number(res.headers.get("X-CareTip-Print-Requested") ?? orderIds.length);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "caretip-physical-qr-prints.zip";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return {
    prepared: Number.isFinite(prepared) ? prepared : 0,
    failed: Number.isFinite(failed) ? failed : 0,
    requested: Number.isFinite(requested) ? requested : orderIds.length,
  };
}

export async function markPlatformPhysicalQrProcessing(orderId: string): Promise<PhysicalQrAdminOrder> {
  return apiRequest(apiPath(`/api/platform/physical-qr/orders/${encodeURIComponent(orderId)}/processing`), {
    method: "POST",
    headers: getHeaders(),
    credentials: "include",
    body: EMPTY_JSON_BODY,
  });
}

export async function shipPlatformPhysicalQrOrder(
  orderId: string,
  payload: { carrier: string; trackingNumber: string; trackingUrl?: string },
): Promise<PhysicalQrAdminOrder> {
  return apiRequest(apiPath(`/api/platform/physical-qr/orders/${encodeURIComponent(orderId)}/ship`), {
    method: "POST",
    headers: getHeaders(),
    credentials: "include",
    body: JSON.stringify(payload),
  });
}

export async function deliverPlatformPhysicalQrOrder(orderId: string): Promise<PhysicalQrAdminOrder> {
  return apiRequest(apiPath(`/api/platform/physical-qr/orders/${encodeURIComponent(orderId)}/deliver`), {
    method: "POST",
    headers: getHeaders(),
    credentials: "include",
    body: EMPTY_JSON_BODY,
  });
}

export async function postPlatformPhysicalQrInternalNote(
  orderId: string,
  body: string,
): Promise<PhysicalQrInternalNote> {
  return apiRequest(apiPath(`/api/platform/physical-qr/orders/${encodeURIComponent(orderId)}/notes`), {
    method: "POST",
    headers: getHeaders(),
    credentials: "include",
    body: JSON.stringify({ body }),
  });
}

export async function createTableAPI(payload: {
  name: string;
  locationId: string;
  qrSlug?: string;
}): Promise<{ id: string; name: string; qrSlug: string; locationId: string }> {
  return apiRequest(apiPath("/api/tables"), {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(payload),
    credentials: "include",
  });
}

/** Guest checkout — Stripe-hosted page (Apple Pay / Google Pay / card where available). */
export async function createTipCheckoutSession(params: {
  amount: number;
  employeeId: string;
  businessId: string;
  tipAmount?: number;
  locationId?: string | null;
  tableId?: string | null;
  customerName?: string | null;
  feedback?: string | null;
}): Promise<{ sessionId: string; url: string | null }> {
  return apiRequest(apiPath("/api/payments/create-tip-session"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...guestQrScanHeaders() },
    body: JSON.stringify({ ...params, qrScanSessionId: getOrCreateQrScanSessionId() }),
  });
}

export type TipSessionContextResponse =
  | {
      status: "pending";
      sessionId: string;
      paymentIntentId?: string | null;
      paymentStatus?: string | null;
      checkoutStatus?: string | null;
    }
  | {
      status: "expired";
      sessionId: string;
    }
  | {
      status: "unpaid";
      sessionId: string;
    }
  | {
      /** Tip ledger exists but is not success (eligibility failure / refund). */
      status: "failed";
      sessionId: string;
      tipId?: string;
      tipStatus?: string;
      paymentIntentId?: string | null;
    }
  | {
      status: "ready";
      sessionId: string;
      paymentIntentId: string | null;
      transactionId: string;
      receiptNumber: string | null;
      employee: { id: string; name: string; avatar: string | null } | null;
      businessId: string;
      locationId: string | null;
      tableId: string | null;
      customerName: string | null;
    };

export type TipSessionReadyContext = Extract<TipSessionContextResponse, { status: "ready" }>;
export type TipSessionPendingContext = Extract<TipSessionContextResponse, { status: "pending" }>;

export async function getTipSessionContext(sessionId: string): Promise<TipSessionContextResponse> {
  const url = apiPath(`/api/payments/tip-session/${encodeURIComponent(sessionId)}`);
  let res: Response;
  try {
    res = await fetchWithNetworkRetry(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    logClientError("api.getTipSessionContext", err, { sessionId });
    throw err;
  }

  const ct = res.headers.get("content-type") ?? "";
  const data = (
    ct.includes("application/json") ? await res.json().catch(() => ({})) : {}
  ) as Partial<TipSessionContextResponse> & { message?: string };

  if (res.status === 202 && data.status === "pending" && typeof data.sessionId === "string") {
    return {
      status: "pending",
      sessionId: data.sessionId,
      paymentIntentId: typeof data.paymentIntentId === "string" ? data.paymentIntentId : null,
      paymentStatus: typeof data.paymentStatus === "string" ? data.paymentStatus : null,
      checkoutStatus: typeof data.checkoutStatus === "string" ? data.checkoutStatus : null,
    };
  }
  if (res.status === 410 && data.status === "expired" && typeof data.sessionId === "string") {
    return { status: "expired", sessionId: data.sessionId };
  }
  if (res.status === 422 && data.status === "unpaid" && typeof data.sessionId === "string") {
    return { status: "unpaid", sessionId: data.sessionId };
  }
  if (res.status === 422 && data.status === "failed" && typeof data.sessionId === "string") {
    return {
      status: "failed",
      sessionId: data.sessionId,
      tipId: typeof data.tipId === "string" ? data.tipId : undefined,
      tipStatus: typeof data.tipStatus === "string" ? data.tipStatus : undefined,
      paymentIntentId: typeof data.paymentIntentId === "string" ? data.paymentIntentId : null,
    };
  }
  if (res.ok && data.status === "ready" && typeof data.sessionId === "string") {
    return data as TipSessionReadyContext;
  }

  const message =
    typeof data.message === "string" && data.message.trim()
      ? data.message.trim()
      : fallbackMessageForHttpStatus(res.status) || `Request failed (${res.status})`;
  throw new ApiRequestError(message, res.status);
}

export async function submitTipFeedback(payload: {
  sessionId: string;
  rating?: number | null;
  comment?: string | null;
  tags?: string[];
  customerName?: string | null;
}): Promise<{ ok: true; feedbackId: string; transactionId: string }> {
  return apiRequest(apiPath("/api/feedback/tip"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export type CustomerFeedbackRow = {
  id: string;
  transactionId: string;
  employeeId: string;
  employeeName: string;
  rating: number | null;
  comment: string | null;
  tags: string[];
  customerName: string | null;
  createdAt: string;
};

export type CustomerFeedbackSummary = {
  averageRating: number | null;
  ratingCount: number;
  feedbackCount: number;
};

export async function listBusinessCustomerFeedback(params: {
  take?: number;
  skip?: number;
  employeeId?: string;
}): Promise<{
  total: number;
  items: CustomerFeedbackRow[];
  summary: CustomerFeedbackSummary;
}> {
  const sp = new URLSearchParams();
  if (params.take != null) sp.set("take", String(params.take));
  if (params.skip != null) sp.set("skip", String(params.skip));
  if (params.employeeId) sp.set("employeeId", params.employeeId);
  const qs = sp.toString();
  return apiRequest(apiPath(`/api/feedback/business${qs ? `?${qs}` : ""}`), {
    headers: getHeaders(),
    credentials: "include",
  });
}

// --- Platform admin (SuperAdmin) ---

export interface PlatformHealthResponse {
  database: "online" | "offline";
  stripe: "online" | "offline";
}

export async function fetchPlatformHealth(): Promise<PlatformHealthResponse> {
  return apiRequest<PlatformHealthResponse>(apiPath("/api/platform/health"), {
    headers: getHeaders(),
    credentials: "include",
  });
}

export interface PlatformGlobalStats {
  totalVolumeEur: number;
  totalVolumeEurFormatted: string;
  transactionCount: number;
  successTransactionCount: number;
  businessesCount: number;
  employeesCount: number;
  locationsCount: number;
  activeUsersCount: number;
  /** Distinct businesses with at least one successful tip */
  businessesWithSuccessfulTips?: number;
  /** Sum of successful tips when grouped by businessId (sanity-check vs totalVolumeEur) */
  platformTotalTipsFromBusinessRollupEur?: number;
  platformTotalsConsistent?: boolean;
}

export type PlatformAnalytics = {
  timezone?: string;
  rangeDays: number;
  userDistribution: Array<{ role: "business" | "employee" | "platform_admin"; count: number }>;
  tipStatus: Array<{ status: "success" | "pending" | "failed"; count: number }>;
  growth: Array<{ date: string; newUsers: number; newBusinesses: number; newTips: number }>;
  tipVolume: Array<{ date: string; tipsEur: number; tipCount: number }>;
  topBusinessesByTips: Array<{ businessId: string; businessName: string; tipsEur: number }>;
  /** Present when the API returned a safe empty fallback after an error. */
  warning?: string;
};

const platformStatsInflight = new Map<string, Promise<PlatformGlobalStats>>();
const platformBusinessesInflight = new Map<string, Promise<{ businesses: PlatformBusinessRow[] }>>();
const platformAnalyticsInflight = new Map<string, Promise<PlatformAnalytics>>();
const platformCommercialInflight = new Map<string, Promise<PlatformCommercialIntelligence>>();

export function clearPlatformAnalyticsClientCache(days = 30, timezone?: string): void {
  const cacheKey = `platform:analytics:${days}:${timezone ?? ""}`;
  platformAnalyticsInflight.delete(cacheKey);
}

export function clearPlatformDashboardClientCache(): void {
  platformStatsInflight.clear();
  platformBusinessesInflight.clear();
  platformAnalyticsInflight.clear();
  platformCommercialInflight.clear();
}

export async function fetchPlatformStats(): Promise<PlatformGlobalStats> {
  const cacheKey = "platform:stats";
  const inflight = platformStatsInflight.get(cacheKey);
  if (inflight) return inflight;
  const promise = apiRequest<PlatformGlobalStats>(apiPath("/api/platform/stats"), {
    headers: getHeaders(),
    credentials: "include",
  })
    .then((stats) => {
      if (import.meta.env.DEV) {
        void fetchPlatformRefunds({ take: 1, skip: 0 })
          .then((refunds) => {
            void import("./assertKpiChartIntegrity").then(({ assertRefundsExcludedFromGmv }) => {
              assertRefundsExcludedFromGmv({
                label: "platform.stats",
                tipGmvEur: stats.totalVolumeEur,
                refundLedgerEur: refunds.ledgerTotalEur ?? 0,
              });
            });
          })
          .catch(() => {
            /* ledger optional in DEV */
          });
      }
      return stats;
    })
    .finally(() => {
      if (platformStatsInflight.get(cacheKey) === promise) platformStatsInflight.delete(cacheKey);
    });
  platformStatsInflight.set(cacheKey, promise);
  return promise;
}

export async function fetchPlatformAnalytics(days = 30, timezone?: string): Promise<PlatformAnalytics> {
  const sp = new URLSearchParams();
  sp.set("days", String(days));
  if (timezone) sp.set("timezone", timezone);
  const cacheKey = `platform:analytics:${days}:${timezone ?? ""}`;
  const inflight = platformAnalyticsInflight.get(cacheKey);
  if (inflight) return inflight;
  const promise = apiRequest<PlatformAnalytics>(apiPath(`/api/platform/analytics?${sp.toString()}`), {
    headers: getHeaders(),
    credentials: "include",
  })
    .then((data) => {
      if (import.meta.env.DEV) {
        if (data.warning) {
          console.warn("[SSOT] platform analytics returned warning scaffold:", data.warning);
        }
        const sum = (data.tipVolume ?? []).reduce((s, r) => s + (Number(r.tipsEur) || 0), 0);
        console.info("[SSOT] platform tipVolume sum", {
          days: data.rangeDays,
          timezone: data.timezone,
          tipVolumeSumEur: sum,
          today: data.tipVolume?.[data.tipVolume.length - 1],
        });
      }
      return data;
    })
    .finally(() => {
    if (platformAnalyticsInflight.get(cacheKey) === promise) platformAnalyticsInflight.delete(cacheKey);
  });
  platformAnalyticsInflight.set(cacheKey, promise);
  return promise;
}

export interface GlobalTransactionRow {
  id: string;
  amountEur: number;
  caretipFeePercent: number;
  caretipFeeFixedCents: number;
  caretipFeeEur: number | null;
  netToStaffEur: number | null;
  payoutStatus: string;
  tipStatus: string;
  stripePaymentIntentId: string | null;
  createdAt: string;
  businessId: string;
  businessName: string;
  employeeName: string;
}

export async function fetchPlatformTransactions(params: {
  q?: string;
  take?: number;
  skip?: number;
}): Promise<{ items: GlobalTransactionRow[]; total: number }> {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.take != null) sp.set("take", String(params.take));
  if (params.skip != null) sp.set("skip", String(params.skip));
  const qs = sp.toString();
  return apiRequest(
    apiPath(`/api/platform/transactions${qs ? `?${qs}` : ""}`),
    { headers: getHeaders(), credentials: "include" }
  );
}

/** Stripe refund / dispute ledger — never inferred from failed tips. */
export type PlatformRefundLedgerRow = {
  id: string;
  businessId: string;
  businessName: string;
  tipId: string | null;
  stripeRefundId: string | null;
  stripePaymentIntentId: string | null;
  stripeChargeId: string | null;
  stripeDisputeId: string | null;
  kind: "refund" | "chargeback" | "dispute";
  status: string;
  amountEur: number;
  originalAmountEur: number | null;
  currency: string;
  reason: string | null;
  occurredAt: string;
};

export async function fetchPlatformRefunds(params: {
  q?: string;
  take?: number;
  skip?: number;
  kind?: string;
  status?: string;
}): Promise<{ items: PlatformRefundLedgerRow[]; total: number; ledgerAvailable: boolean; ledgerTotalEur?: number; message?: string }> {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.kind) sp.set("kind", params.kind);
  if (params.status) sp.set("status", params.status);
  if (params.take != null) sp.set("take", String(params.take));
  if (params.skip != null) sp.set("skip", String(params.skip));
  const qs = sp.toString();
  return apiRequest(
    apiPath(`/api/platform/refunds${qs ? `?${qs}` : ""}`),
    { headers: getHeaders(), credentials: "include" },
  );
}

export function buildPlatformRefundsExportUrl(params: {
  q?: string;
  kind?: string;
  status?: string;
}): string {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.kind) sp.set("kind", params.kind);
  if (params.status) sp.set("status", params.status);
  const qs = sp.toString();
  return apiPath(`/api/platform/refunds/export${qs ? `?${qs}` : ""}`);
}

export async function downloadPlatformRefundsCsv(params: {
  q?: string;
  kind?: string;
  status?: string;
}): Promise<void> {
  const token = getToken();
  const res = await fetch(buildPlatformRefundsExportUrl(params), {
    method: "GET",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error("No refund data available");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "caretip-refunds-ledger.csv";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export type PlatformBusinessOperationalStatus = "active" | "suspended" | "inactive";

export interface PlatformBusinessRow {
  id: string;
  name: string;
  slug: string;
  /** @deprecated Legacy mirror of KYC outcome — use `kycVerificationStatus`. */
  verificationStatus: "pending" | "verified" | "rejected";
  onboardingVerificationStatus?: OnboardingVerificationStatus;
  kycVerificationStatus?: KycVerificationStatus;
  onboardingSubmittedAt?: string | null;
  onboardingReviewNotes?: string | null;
  onboardingReviewHistory?: Array<{ status: string; at: string; note?: string | null }>;
  legalContactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  website?: string | null;
  registeredAddress: string | null;
  ownerUserId: string;
  ownerEmail: string;
  staffCount?: number;
  locationCount?: number;
  /** Sum of successful tip amounts (EUR) for this business */
  totalTipsEur?: number;
  /** Count of successful tips for this business */
  successTipCount?: number;
  logoPath?: string | null;
  verificationDocumentPath?: string | null;
  subscriptionTier?: "basic" | "premium" | "enterprise";
  subscriptionStatus?: string | null;
  cancelAtPeriodEnd?: boolean;
  hasCompletedOnboarding?: boolean;
  kycDocuments?: {
    registration?: string | null;
    address?: string | null;
    governmentId?: string | null;
    additional?: string[];
  };
  kycSubmittedAt?: string | null;
  kycReviewNotes?: string | null;
  kycReviewHistory?: Array<{ status: string; at: string; note?: string | null }>;
  kycHoursPending?: number | null;
  kycSlaBreached?: boolean;
  /** Owner account creation — proxy for business registration date */
  registeredAt?: string | null;
  /** When false, the owner account is suspended */
  ownerIsActive?: boolean;
  operationalStatus?: PlatformBusinessOperationalStatus;
}

export type PlatformBusinessStatusFilter =
  | "all"
  | "verified"
  | "pending_review"
  | "awaiting_upload"
  | "sla_breach"
  | "rejected"
  | "suspended"
  | "inactive"
  | "draft"
  | "submitted"
  | "approved"
  | "not_started";

export type PlatformBusinessDatePreset =
  | "all"
  | "today"
  | "last_7"
  | "last_30"
  | "this_month"
  | "last_month"
  | "custom";

export type PlatformBusinessTipsFilter =
  | "all"
  | "zero"
  | "1_500"
  | "501_5000"
  | "5001_plus"
  | "highest"
  | "lowest";

export type PlatformBusinessSort =
  | "newest"
  | "oldest"
  | "tips_high"
  | "tips_low"
  | "name_asc"
  | "name_desc";

export type PlatformBusinessListParams = {
  q?: string;
  status?: PlatformBusinessStatusFilter;
  workflow?: "onboarding" | "kyc";
  date?: PlatformBusinessDatePreset;
  dateFrom?: string;
  dateTo?: string;
  tips?: PlatformBusinessTipsFilter;
  sort?: PlatformBusinessSort;
  take?: number;
  skip?: number;
  page?: number;
};

export type PlatformBusinessListResult = {
  businesses: PlatformBusinessRow[];
  total?: number;
  warning?: string;
};

export type KycQueueMetrics = {
  pendingReview: number;
  slaBreached: number;
  awaitingUpload: number;
  verified: number;
  slaHours: number;
};

export type OnboardingQueueMetrics = {
  draft: number;
  submitted: number;
  approved: number;
  rejected: number;
  /** Onboarding approved + KYC verified — hidden in MVP until KYC ships. */
  fullyVerified?: number;
};

export async function fetchKycQueueMetrics(): Promise<KycQueueMetrics> {
  return apiRequest<KycQueueMetrics>(apiPath("/api/platform/kyc/metrics"), {
    headers: getHeaders(),
    credentials: "include",
  });
}

export async function fetchOnboardingQueueMetrics(): Promise<OnboardingQueueMetrics> {
  return apiRequest<OnboardingQueueMetrics>(apiPath("/api/platform/onboarding/metrics"), {
    headers: getHeaders(),
    credentials: "include",
  });
}

export async function updatePlatformBusinessKycReviewNotes(
  businessId: string,
  notes: string | null,
): Promise<{ success: boolean; business: PlatformBusinessRow }> {
  return apiRequest(apiPath(`/api/platform/businesses/${encodeURIComponent(businessId)}/kyc-review-notes`), {
    method: "PATCH",
    headers: getHeaders(),
    body: JSON.stringify({ notes }),
    credentials: "include",
  });
}

export async function fetchPlatformBusinesses(): Promise<{ businesses: PlatformBusinessRow[] }>;
export async function fetchPlatformBusinesses(
  params: PlatformBusinessListParams,
): Promise<PlatformBusinessListResult>;
export async function fetchPlatformBusinesses(
  params?: PlatformBusinessListParams,
): Promise<PlatformBusinessListResult> {
  if (!params || Object.keys(params).length === 0) {
    const cacheKey = "platform:businesses";
    const inflight = platformBusinessesInflight.get(cacheKey);
    if (inflight) return inflight;
    const promise = apiRequest<{ businesses: PlatformBusinessRow[] }>(apiPath("/api/platform/businesses"), {
      headers: getHeaders(),
      credentials: "include",
    }).finally(() => {
      if (platformBusinessesInflight.get(cacheKey) === promise) platformBusinessesInflight.delete(cacheKey);
    });
    platformBusinessesInflight.set(cacheKey, promise);
    return promise;
  }

  const search = new URLSearchParams();
  if (params.q?.trim()) search.set("q", params.q.trim());
  if (params.status && params.status !== "all") search.set("status", params.status);
  if (params.workflow) search.set("workflow", params.workflow);
  if (params.date && params.date !== "all") search.set("date", params.date);
  if (params.dateFrom) search.set("dateFrom", params.dateFrom);
  if (params.dateTo) search.set("dateTo", params.dateTo);
  if (params.tips && params.tips !== "all") search.set("tips", params.tips);
  if (params.sort && params.sort !== "newest") search.set("sort", params.sort);
  search.set("take", String(params.take ?? 25));
  if (params.skip != null) search.set("skip", String(params.skip));
  if (params.page != null && params.page > 0) search.set("page", String(params.page));
  const qs = search.toString();
  return apiRequest<PlatformBusinessListResult>(apiPath(`/api/platform/businesses?${qs}`), {
    headers: getHeaders(),
    credentials: "include",
  });
}

export type PlatformVerificationAction = "verified" | "rejected" | "pending";
export type PlatformOnboardingVerificationAction = "approved" | "rejected";

export async function updatePlatformBusinessOnboardingStatus(
  businessId: string,
  status: PlatformOnboardingVerificationAction,
  reviewNote?: string,
): Promise<void> {
  await apiRequest(apiPath(`/api/platform/businesses/${encodeURIComponent(businessId)}/verify-onboarding`), {
    method: "PATCH",
    headers: getHeaders(),
    body: JSON.stringify({ status, ...(reviewNote?.trim() ? { reviewNote: reviewNote.trim() } : {}) }),
    credentials: "include",
  });
  clearPlatformDashboardClientCache();
}

export type PlatformBusinessOperationalAction = "active" | "suspended" | "inactive";

export async function updatePlatformBusinessOperationalStatus(
  businessId: string,
  status: PlatformBusinessOperationalAction,
  reviewNote?: string,
): Promise<void> {
  await apiRequest(
    apiPath(`/api/platform/businesses/${encodeURIComponent(businessId)}/operational-status`),
    {
      method: "PATCH",
      headers: getHeaders(),
      body: JSON.stringify({
        status,
        ...(reviewNote?.trim() ? { reviewNote: reviewNote.trim() } : {}),
      }),
      credentials: "include",
    },
  );
  clearPlatformDashboardClientCache();
}

export async function softDeletePlatformBusiness(
  businessId: string,
  reason?: string,
): Promise<void> {
  await apiRequest(apiPath(`/api/platform/businesses/${encodeURIComponent(businessId)}/soft-delete`), {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ ...(reason?.trim() ? { reason: reason.trim() } : {}) }),
    credentials: "include",
  });
  clearPlatformDashboardClientCache();
}

export async function updatePlatformBusinessKycStatus(
  businessId: string,
  status: PlatformVerificationAction,
  reviewNote?: string,
): Promise<void> {
  await apiRequest(apiPath(`/api/platform/businesses/${encodeURIComponent(businessId)}/verify-kyc`), {
    method: "PATCH",
    headers: getHeaders(),
    body: JSON.stringify({ status, ...(reviewNote?.trim() ? { reviewNote: reviewNote.trim() } : {}) }),
    credentials: "include",
  });
}

export async function updatePlatformBusinessVerificationStatus(
  businessId: string,
  status: PlatformVerificationAction,
  reviewNote?: string,
): Promise<void> {
  await updatePlatformBusinessKycStatus(businessId, status, reviewNote);
}

/** Approve business KYC (verified). */
export async function verifyPlatformBusiness(businessId: string): Promise<void> {
  await updatePlatformBusinessVerificationStatus(businessId, "verified");
}

export async function fetchPlatformBusiness(
  businessId: string
): Promise<{ business: PlatformBusinessRow }> {
  return apiRequest(apiPath(`/api/platform/businesses/${encodeURIComponent(businessId)}`), {
    headers: getHeaders(),
    credentials: "include",
  });
}

/** Slice G — category-specific legal hold (platform-admin APIs). Matches backend LEGAL_HOLD_API_CATEGORIES. */
export const PLATFORM_LEGAL_HOLD_CATEGORIES = [
  "financial",
  "payment",
  "kyc",
  "audit",
  "support",
  "analytics",
  "guest",
  "staff_pii",
  "billing",
  "notify",
  "profile",
  "staff-profile",
] as const;

export type PlatformLegalHoldCategory = (typeof PLATFORM_LEGAL_HOLD_CATEGORIES)[number];

export type PlatformLegalHoldState = {
  subjectType: "user" | "business";
  subjectId: string;
  legalHold: boolean;
  legalHoldReason: string | null;
  legalHoldCategories: string[];
  legalHoldSetAt: string | null;
  legalHoldSetByUserId: string | null;
};

export async function fetchPlatformUserLegalHold(
  userId: string,
): Promise<PlatformLegalHoldState> {
  return apiRequest(apiPath(`/api/platform/users/${encodeURIComponent(userId)}/legal-hold`), {
    headers: getHeaders(),
    credentials: "include",
  });
}

export async function setPlatformUserLegalHold(
  userId: string,
  input: { reason: string; categories: string[] },
): Promise<PlatformLegalHoldState> {
  return apiRequest(apiPath(`/api/platform/users/${encodeURIComponent(userId)}/legal-hold`), {
    method: "PUT",
    headers: getHeaders(),
    body: JSON.stringify({
      reason: input.reason,
      categories: input.categories,
    }),
    credentials: "include",
  });
}

export async function clearPlatformUserLegalHold(
  userId: string,
): Promise<PlatformLegalHoldState> {
  return apiRequest(apiPath(`/api/platform/users/${encodeURIComponent(userId)}/legal-hold`), {
    method: "DELETE",
    headers: getHeaders(),
    credentials: "include",
  });
}

export async function fetchPlatformBusinessLegalHold(
  businessId: string,
): Promise<PlatformLegalHoldState> {
  return apiRequest(
    apiPath(`/api/platform/businesses/${encodeURIComponent(businessId)}/legal-hold`),
    {
      headers: getHeaders(),
      credentials: "include",
    },
  );
}

export async function setPlatformBusinessLegalHold(
  businessId: string,
  input: { reason: string; categories: string[] },
): Promise<PlatformLegalHoldState> {
  return apiRequest(
    apiPath(`/api/platform/businesses/${encodeURIComponent(businessId)}/legal-hold`),
    {
      method: "PUT",
      headers: getHeaders(),
      body: JSON.stringify({
        reason: input.reason,
        categories: input.categories,
      }),
      credentials: "include",
    },
  );
}

export async function clearPlatformBusinessLegalHold(
  businessId: string,
): Promise<PlatformLegalHoldState> {
  return apiRequest(
    apiPath(`/api/platform/businesses/${encodeURIComponent(businessId)}/legal-hold`),
    {
      method: "DELETE",
      headers: getHeaders(),
      credentials: "include",
    },
  );
}

/** Platform-admin–only subject lookup for Legal Hold UI (minimal fields). */
export type PlatformLegalHoldSubjectHit = {
  id: string;
  label: string;
  secondary: string | null;
  subjectType: "user" | "business";
};

export async function searchPlatformLegalHoldSubjects(input: {
  type: "user" | "business";
  q: string;
}): Promise<{ items: PlatformLegalHoldSubjectHit[] }> {
  const q = input.q.trim();
  if (!q) return { items: [] };
  const params = new URLSearchParams({
    type: input.type,
    q,
  });
  return apiRequest(apiPath(`/api/platform/legal-hold/subjects?${params.toString()}`), {
    headers: getHeaders(),
    credentials: "include",
  });
}

export interface PlatformAuditLogRow {
  id: string;
  action: string;
  userId: string;
  userEmail: string;
  metadata: string | null;
  createdAt: string;
}

export async function fetchPlatformAuditLogs(params: {
  take?: number;
  skip?: number;
}): Promise<{ items: PlatformAuditLogRow[]; total: number }> {
  const sp = new URLSearchParams();
  if (params.take != null) sp.set("take", String(params.take));
  if (params.skip != null) sp.set("skip", String(params.skip));
  const qs = sp.toString();
  return apiRequest(apiPath(`/api/platform/audit-logs${qs ? `?${qs}` : ""}`), {
    headers: getHeaders(),
    credentials: "include",
  });
}

export async function updatePlatformBusinessKyc(
  businessId: string,
  body: {
    legalContactName?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
    website?: string | null;
    registeredAddress?: string | null;
  }
): Promise<{ success: boolean; business: PlatformBusinessRow }> {
  return apiRequest(apiPath(`/api/platform/businesses/${encodeURIComponent(businessId)}`), {
    method: "PATCH",
    headers: getHeaders(),
    body: JSON.stringify(body),
    credentials: "include",
  });
}

export async function updatePlatformBusinessSubscriptionTier(
  businessId: string,
  subscriptionTier: "basic" | "premium" | "enterprise",
): Promise<{ success: boolean; business: PlatformBusinessRow }> {
  return apiRequest(
    apiPath(`/api/platform/businesses/${encodeURIComponent(businessId)}/subscription-tier`),
    {
      method: "PATCH",
      headers: getHeaders(),
      body: JSON.stringify({ subscriptionTier }),
      credentials: "include",
    },
  );
}

export type SponsoredAccessGrantStatus = "pending" | "active" | "revoked" | "expired";

export type SponsoredCapabilityProfileKey = "starter" | "business" | "enterprise";

export interface SponsoredAccessGrant {
  id: string;
  businessId: string;
  programmeKey: string;
  programmeLabelKey: string;
  capabilityProfileKey: string | null;
  effectiveProfileKey: SponsoredCapabilityProfileKey | null;
  status: SponsoredAccessGrantStatus;
  approvedAt: string | null;
  approvedByUserId: string | null;
  approvedByEmail: string | null;
  expiresAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SponsoredProgrammeOption {
  programmeKey: string;
  profileKey: SponsoredCapabilityProfileKey;
  labelKey: string;
}

export interface SponsoredCapabilityProfileOption {
  profileKey: SponsoredCapabilityProfileKey;
  labelKey: string;
}

export async function fetchSponsoredProgrammes(): Promise<{
  programmes: SponsoredProgrammeOption[];
  capabilityProfiles: SponsoredCapabilityProfileOption[];
}> {
  return apiRequest(apiPath("/api/platform/sponsored-access/programmes"), {
    headers: getHeaders(),
    credentials: "include",
  });
}

export async function fetchBusinessSponsoredAccess(
  businessId: string,
): Promise<{ grants: SponsoredAccessGrant[] }> {
  return apiRequest(
    apiPath(`/api/platform/businesses/${encodeURIComponent(businessId)}/sponsored-access`),
    { headers: getHeaders(), credentials: "include" },
  );
}

export async function createBusinessSponsoredAccess(
  businessId: string,
  body: {
    programmeKey: string;
    capabilityProfileKey?: SponsoredCapabilityProfileKey | null;
    notes?: string | null;
    expiresAt?: string | null;
    activate?: boolean;
  },
): Promise<{ grant: SponsoredAccessGrant }> {
  return apiRequest(
    apiPath(`/api/platform/businesses/${encodeURIComponent(businessId)}/sponsored-access`),
    {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify(body),
      credentials: "include",
    },
  );
}

export async function updateBusinessSponsoredAccess(
  businessId: string,
  grantId: string,
  body: {
    programmeKey?: string;
    capabilityProfileKey?: SponsoredCapabilityProfileKey | null;
    notes?: string | null;
    expiresAt?: string | null;
    clearExpiresAt?: boolean;
  },
): Promise<{ grant: SponsoredAccessGrant }> {
  return apiRequest(
    apiPath(
      `/api/platform/businesses/${encodeURIComponent(businessId)}/sponsored-access/${encodeURIComponent(grantId)}`,
    ),
    {
      method: "PATCH",
      headers: getHeaders(),
      body: JSON.stringify(body),
      credentials: "include",
    },
  );
}

export async function activateBusinessSponsoredAccess(
  businessId: string,
  grantId: string,
): Promise<{ grant: SponsoredAccessGrant }> {
  return apiRequest(
    apiPath(
      `/api/platform/businesses/${encodeURIComponent(businessId)}/sponsored-access/${encodeURIComponent(grantId)}/activate`,
    ),
    { method: "POST", headers: getHeaders(), credentials: "include" },
  );
}

export async function revokeBusinessSponsoredAccess(
  businessId: string,
  grantId: string,
): Promise<{ grant: SponsoredAccessGrant }> {
  return apiRequest(
    apiPath(
      `/api/platform/businesses/${encodeURIComponent(businessId)}/sponsored-access/${encodeURIComponent(grantId)}/revoke`,
    ),
    { method: "POST", headers: getHeaders(), credentials: "include" },
  );
}

export async function uploadPlatformBusinessLogo(
  businessId: string,
  file: File
): Promise<{ success: boolean; path: string }> {
  const check = validateImageFileForUpload(file);
  if (!check.ok) {
    throw new Error(toUserFriendlyMessage(new Error(check.message)));
  }
  const form = new FormData();
  form.append("file", file);
  return apiRequest(apiPath(`/api/platform/businesses/${encodeURIComponent(businessId)}/logo`), {
    method: "POST",
    headers: getAuthHeadersOnly(),
    body: form,
    credentials: "include",
  });
}

export async function uploadPlatformBusinessVerification(
  businessId: string,
  file: File
): Promise<{ success: boolean; path: string }> {
  const form = new FormData();
  form.append("file", file);
  return apiRequest(
    apiPath(`/api/platform/businesses/${encodeURIComponent(businessId)}/verification-document`),
    {
      method: "POST",
      headers: getAuthHeadersOnly(),
      body: form,
      credentials: "include",
    }
  );
}

export async function impersonateManagerAPI(businessId: string): Promise<AuthResponse> {
  return apiRequest<AuthResponse>(apiPath("/api/platform/impersonate"), {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ businessId }),
    credentials: "include",
  });
}

export type LandingAiDiagnosticsResponse = {
  config: {
    openAiConfigured: boolean;
    model: string;
    keySource: "landing" | "shared" | "none";
  };
  metrics: {
    totalChats: number;
    openAiSuccess: number;
    openAiFailures: number;
    fallbackCount: number;
    quotaFailures: number;
    timeoutFailures: number;
    networkFailures: number;
    openAiSuccessRate: number;
    fallbackRate: number;
    quotaFailureRate: number;
    lastOpenAiSuccessAt: string | null;
    lastFallbackAt: string | null;
    lastFallbackReason: string | null;
    lastOpenAiHttpStatus: number | null;
  };
  probe: {
    reachable: boolean;
    httpStatus?: number;
    errorHint?: string;
  };
};

export async function fetchLandingAiDiagnostics(): Promise<LandingAiDiagnosticsResponse> {
  return apiRequest<LandingAiDiagnosticsResponse>(apiPath("/api/landing-ai/diagnostics"), {
    headers: getHeaders(),
    credentials: "include",
  });
}

// —— Sprint 7: Commercial maturity ——

export type FeatureUtilizationRow = {
  featureKey: string;
  hits30d: number;
  lastUsedAt: string | null;
  source: "tracked" | "inferred";
};

export type UpgradeOpportunity = {
  id: string;
  suggestedTier: "premium" | "enterprise";
  reasonCode: string;
  evidence: Record<string, string | number>;
  sourceKpi: string;
  calculationPath: string;
};

export type RetentionRiskLevel = "low" | "medium" | "high";

export type RetentionSignal = {
  id: string;
  reasonCode: string;
  evidence: Record<string, string | number>;
  sourceKpi: string;
  calculationPath: string;
  severity: RetentionRiskLevel;
};

export type ManagerCommercialInsights = {
  utilization: FeatureUtilizationRow[];
  upgradeOpportunities: UpgradeOpportunity[];
  retention: { level: RetentionRiskLevel; signals: RetentionSignal[] };
  tier: "basic" | "premium" | "enterprise";
};

export async function fetchManagerCommercialInsights(): Promise<ManagerCommercialInsights> {
  return apiRequest<ManagerCommercialInsights>(apiPath("/api/business/commercial/insights"), {
    headers: getHeaders(),
    credentials: "include",
  });
}

export async function postCommercialFeatureUtilization(featureKeys: string[]): Promise<void> {
  await apiRequest(apiPath("/api/business/commercial/feature-utilization"), {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ featureKeys }),
    credentials: "include",
  });
}

export type SubscriptionIntelligence = {
  periodDays: number;
  upgrades: number;
  downgrades: number;
  cancellationsScheduled: number;
  paymentFailures: number;
  renewalsSucceeded: number;
  activeSubscriptions: number;
  cancelAtPeriodEnd: number;
  trialing: number;
  pastDue: number;
  byTier: { basic: number; premium: number; enterprise: number };
};

export type PlatformCommercialBusinessInsight = {
  businessId: string;
  name: string;
  tier: string;
  segment: "growth" | "at_risk" | "premium_opportunity" | "enterprise_candidate";
  reasonCode: string;
  evidence: Record<string, string | number>;
};

export type PlatformCommercialIntelligence = {
  subscription: SubscriptionIntelligence;
  enterpriseReadiness: {
    score: number;
    maxScore: number;
    checks: Array<{ id: string; passed: boolean; label: string }>;
  };
  segments: {
    growthCandidates: PlatformCommercialBusinessInsight[];
    atRisk: PlatformCommercialBusinessInsight[];
    premiumOpportunities: PlatformCommercialBusinessInsight[];
    enterpriseCandidates: PlatformCommercialBusinessInsight[];
  };
};

export async function fetchPlatformCommercialIntelligence(): Promise<PlatformCommercialIntelligence> {
  const cacheKey = "platform:commercial-intelligence";
  const inflight = platformCommercialInflight.get(cacheKey);
  if (inflight) return inflight;
  const promise = apiRequest<PlatformCommercialIntelligence>(
    apiPath("/api/platform/commercial-intelligence"),
    {
      headers: getHeaders(),
      credentials: "include",
    },
  ).finally(() => {
    if (platformCommercialInflight.get(cacheKey) === promise) platformCommercialInflight.delete(cacheKey);
  });
  platformCommercialInflight.set(cacheKey, promise);
  return promise;
}

export type PlatformSubscriptionActivityFilter =
  | "all"
  | "successful"
  | "failed"
  | "trialing"
  | "active"
  | "cancelled"
  | "past_due";

export type PlatformSubscriptionPaymentStatus = "succeeded" | "failed" | "pending" | "none";

export type PlatformSubscriptionOverview = {
  active: number;
  trialing: number;
  successful: number;
  failed: number;
  cancelled: number;
  expired: number;
};

export type PlatformSubscriptionWidgets = {
  successRatePercent: number;
  failedPaymentsToday: number;
  failedPaymentsThisWeek: number;
  trialsEndingSoon: number;
  renewalsDueToday: number;
};

export type PlatformSubscriptionMonitoring = {
  overview: PlatformSubscriptionOverview;
  widgets: PlatformSubscriptionWidgets;
  periodDays: number;
};

export type PlatformSubscriptionActivityRow = {
  businessId: string;
  businessName: string;
  contactEmail: string | null;
  planKey: string;
  billingCycle: string;
  status: SubscriptionStatus;
  paymentStatus: PlatformSubscriptionPaymentStatus;
  amountCents: number | null;
  billingPeriodEnd: string | null;
  activityAt: string;
  lastPaymentAttemptAt: string | null;
};

export type PlatformSubscriptionActivityResult = {
  items: PlatformSubscriptionActivityRow[];
  total: number;
};

const platformSubscriptionInflight = new Map<string, Promise<unknown>>();

export async function fetchPlatformSubscriptionMonitoring(
  days = 30,
): Promise<PlatformSubscriptionMonitoring> {
  const cacheKey = `platform:subscriptions:monitoring:${days}`;
  const inflight = platformSubscriptionInflight.get(cacheKey);
  if (inflight) return inflight as Promise<PlatformSubscriptionMonitoring>;
  const promise = apiRequest<PlatformSubscriptionMonitoring>(
    apiPath(`/api/platform/subscriptions/monitoring?days=${days}`),
    {
      headers: getHeaders(),
      credentials: "include",
    },
  ).finally(() => {
    if (platformSubscriptionInflight.get(cacheKey) === promise) {
      platformSubscriptionInflight.delete(cacheKey);
    }
  });
  platformSubscriptionInflight.set(cacheKey, promise);
  return promise;
}

export async function fetchPlatformSubscriptionActivity(params: {
  filter?: PlatformSubscriptionActivityFilter;
  q?: string;
  take?: number;
  skip?: number;
  sort?: "date" | "business" | "status" | "amount";
  sortDir?: "asc" | "desc";
}): Promise<PlatformSubscriptionActivityResult> {
  const search = new URLSearchParams();
  if (params.filter && params.filter !== "all") search.set("filter", params.filter);
  if (params.q?.trim()) search.set("q", params.q.trim());
  search.set("take", String(params.take ?? 25));
  search.set("skip", String(params.skip ?? 0));
  if (params.sort) search.set("sort", params.sort);
  if (params.sortDir) search.set("sortDir", params.sortDir);
  const qs = search.toString();
  return apiRequest<PlatformSubscriptionActivityResult>(
    apiPath(`/api/platform/subscriptions/activity?${qs}`),
    {
      headers: getHeaders(),
      credentials: "include",
    },
  );
}
