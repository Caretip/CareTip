import axios, {
  type AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from "axios";
import { config } from "@/constants/config";
import {
  clearAccessToken,
  getAccessToken,
  getRefreshToken,
  saveAccessToken,
  saveRefreshToken,
} from "@/services/auth/tokenStorage";
import { API_ENDPOINTS } from "@/constants/endpoints";
import { buildRefreshCookieHeader, extractRefreshTokenFromHeaders } from "@/utils/refreshCookie";
import { reportGlobalError } from "@/utils/errors";
import { notifySessionExpired } from "@/utils/sessionExpiry";
import { logAuthEvent, logOutgoingAuthHeader } from "@/utils/authDebug";
import { normalizeApiError } from "@/types/api";
import type { AuthResponse } from "@/types/auth";

type RetriableConfig = InternalAxiosRequestConfig & {
  __caretipRetried?: boolean;
};

let memoryAccessToken: string | null = null;
let refreshPromise: Promise<string | null> | null = null;

export function setMemoryAccessToken(token: string | null): void {
  memoryAccessToken = token;
}

export function getMemoryAccessToken(): string | null {
  return memoryAccessToken;
}

export async function hydrateAccessTokenFromSecureStore(): Promise<string | null> {
  const token = await getAccessToken();
  memoryAccessToken = token;
  return token;
}

export async function persistRefreshFromResponse(headers: unknown): Promise<boolean> {
  const refresh = extractRefreshTokenFromHeaders(headers);
  if (!refresh) {
    const map =
      headers && typeof headers === "object" && "toJSON" in headers
        ? (headers as { toJSON: () => Record<string, unknown> }).toJSON()
        : (headers as Record<string, unknown> | undefined);
    logAuthEvent("refresh.persist.miss", {
      hasSetCookie: Boolean(map?.["set-cookie"] ?? map?.["Set-Cookie"]),
      hasNativeHeader: Boolean(map?.["x-caretip-refresh"] ?? map?.["X-CareTip-Refresh"]),
      headerKeys: map ? Object.keys(map) : [],
    });
    return false;
  }
  await saveRefreshToken(refresh);
  const readBack = await getRefreshToken();
  const ok = Boolean(readBack) && readBack === refresh;
  logAuthEvent(ok ? "refresh.persist.ok" : "refresh.persist.readback.mismatch", {
    source: "set-cookie-or-x-caretip-refresh",
    secureStoreReadBack: Boolean(readBack),
  });
  return ok;
}

export const apiClient: AxiosInstance = axios.create({
  baseURL: config.apiUrl,
  timeout: config.apiTimeoutMs,
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
    [config.clientHeaderName]: config.clientHeader,
  },
});

/** Public auth paths must never trigger silent refresh / Bearer recovery loops. */
function isPublicAuthPath(url: string | undefined): boolean {
  const path = url ?? "";
  return (
    path.includes("/api/auth/signin") ||
    path.includes("/api/auth/login") ||
    path.includes("/api/auth/refresh") ||
    path.includes("/api/auth/logout") ||
    path.includes("/api/auth/register")
  );
}

apiClient.interceptors.request.use(async (request) => {
  const path = request.url ?? "";
  const isPublicAuth = isPublicAuthPath(path);

  // Do not attach stale Bearer to public login — matches web loginAPI (no Authorization).
  if (!isPublicAuth || path.includes("/api/auth/refresh") || path.includes("/api/auth/logout")) {
    const token = memoryAccessToken ?? (await getAccessToken());
    if (token) {
      memoryAccessToken = token;
      request.headers.Authorization = `Bearer ${token}`;
    }
    if (__DEV__) {
      logOutgoingAuthHeader(Boolean(token), token);
      logAuthEvent("outgoing.protected.check", {
        path,
        fullUrl: `${request.baseURL ?? ""}${path}`,
        hasAuthorizationBearer: Boolean(token),
      });
    }
  } else if (__DEV__) {
    logAuthEvent("outgoing.public.auth", {
      path,
      fullUrl: `${request.baseURL ?? ""}${path}`,
      authorization: "(intentionally omitted)",
    });
  }
  return request;
});

async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const refreshToken = await getRefreshToken();
      const headers: Record<string, string> = {
        [config.clientHeaderName]: config.clientHeader,
        "Content-Type": "application/json",
      };
      if (refreshToken) {
        headers.Cookie = buildRefreshCookieHeader(refreshToken);
      } else if (memoryAccessToken) {
        // Backend grace path: accept Bearer access JWT when cookie is missing.
        headers.Authorization = `Bearer ${memoryAccessToken}`;
      }

      const response = await axios.post<AuthResponse>(
        `${config.apiUrl}${API_ENDPOINTS.auth.refresh}`,
        {},
        { headers, timeout: config.apiTimeoutMs },
      );

      await persistRefreshFromResponse(response.headers as Record<string, unknown>);
      const nextToken = response.data.token;
      memoryAccessToken = nextToken;
      await saveAccessToken(nextToken);
      return nextToken;
    } catch (error) {
      memoryAccessToken = null;
      await clearAccessToken();
      logAuthEvent("refresh.failed", {
        status: (error as AxiosError)?.response?.status ?? null,
        message: (error as AxiosError<{ message?: string }>)?.response?.data?.message ?? "unknown",
      });
      notifySessionExpired();
      reportGlobalError(error);
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

apiClient.interceptors.response.use(
  async (response) => {
    await persistRefreshFromResponse(response.headers as Record<string, unknown>);
    return response;
  },
  async (error: AxiosError) => {
    const original = error.config as RetriableConfig | undefined;
    const status = error.response?.status;
    const data = error.response?.data;
    const backendReason =
      typeof data === "object" && data
        ? [
            "message" in data ? String((data as { message?: string }).message ?? "") : "",
            "error" in data ? String((data as { error?: string }).error ?? "") : "",
            "code" in data ? String((data as { code?: string }).code ?? "") : "",
          ]
            .filter(Boolean)
            .join(" | ") || JSON.stringify(data)
        : typeof data === "string"
          ? data
          : undefined;

    if (status === 401) {
      logAuthEvent("protected.401", {
        path: original?.url,
        fullUrl: original ? `${original.baseURL ?? ""}${original.url ?? ""}` : undefined,
        backendReason: backendReason || "Authentication required",
        hadBearer: Boolean(original?.headers?.Authorization ?? original?.headers?.authorization),
        publicAuthPath: isPublicAuthPath(original?.url),
      });
    }

    // Match web: never silent-refresh on /api/auth/refresh (or other public auth routes).
    if (
      status === 401 &&
      original &&
      !original.__caretipRetried &&
      !isPublicAuthPath(original.url)
    ) {
      original.__caretipRetried = true;
      const nextToken = await refreshAccessToken();
      if (nextToken) {
        original.headers = original.headers ?? {};
        original.headers.Authorization = `Bearer ${nextToken}`;
        return apiClient.request(original);
      }
      notifySessionExpired();
    }

    // Transport failures are shown by screen ErrorStates — avoid global "offline" spam.
    if (status && status !== 401) {
      reportGlobalError(error);
    } else if (!status && __DEV__) {
      const normalized = normalizeApiError(error);
      console.warn(
        "[CareTip][API]",
        normalized.status,
        normalized.message,
        original?.url,
        error.code,
      );
    }

    return Promise.reject(error);
  },
);

export async function apiRequest<T>(configOverride: AxiosRequestConfig): Promise<T> {
  const response = await apiClient.request<T>(configOverride);
  return response.data;
}

export { refreshAccessToken };
