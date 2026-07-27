import { API_ENDPOINTS } from "@/constants/endpoints";
import {
  apiClient,
  persistRefreshFromResponse,
  setMemoryAccessToken,
} from "@/services/api/client";
import { refreshSession } from "@/services/auth/authService";
import {
  getRefreshToken,
  saveAccessToken,
  saveUserSnapshot,
} from "@/services/auth/tokenStorage";
import {
  headerLookup,
  logAuthEvent,
  logLoginTrace,
  serializeResponseHeaders,
} from "@/utils/authDebug";
import { config } from "@/constants/config";
import type { AuthResponse } from "@/types/auth";
import type { TwoFactorSetup } from "@/types/settings";
import { normalizeApiError } from "@/types/api";

async function persistSession(data: AuthResponse): Promise<AuthResponse> {
  setMemoryAccessToken(data.token);
  await saveAccessToken(data.token);
  await saveUserSnapshot(data.user);
  return data;
}

/** Login-time MFA enrollment — matches web `loginMfaSetupAPI`. */
export async function setupLoginMfa(pendingMfaToken: string): Promise<TwoFactorSetup> {
  const { data } = await apiClient.post<TwoFactorSetup>(API_ENDPOINTS.authMfa.setup, {
    pendingMfaToken,
  });
  return data;
}

/**
 * MFA complete — same as web: access token from MFA response is enough.
 * Post-login refresh is optional continuity, not a login gate.
 */
export async function verifyMfaLogin(
  pendingMfaToken: string,
  code: string,
  setupRequired: boolean,
): Promise<AuthResponse> {
  const endpoint = setupRequired
    ? API_ENDPOINTS.authMfa.enable
    : API_ENDPOINTS.authMfa.verify;
  const requestUrl = `${config.apiUrl}${endpoint}`;

  logAuthEvent("mfa.request", {
    method: "POST",
    url: requestUrl,
    path: endpoint,
  });

  const response = await apiClient.post<AuthResponse>(endpoint, {
    pendingMfaToken,
    code,
  });

  const headerMap = serializeResponseHeaders(response.headers);
  logAuthEvent("mfa.response.headers", {
    status: response.status,
    requestUrl,
    headerKeys: Object.keys(headerMap),
  });

  const hasRefreshHeader = Boolean(
    headerLookup(headerMap, "x-caretip-refresh") ?? headerLookup(headerMap, "X-CareTip-Refresh"),
  );
  const hasSetCookie = Boolean(
    headerLookup(headerMap, "set-cookie") ?? headerLookup(headerMap, "Set-Cookie"),
  );

  const refreshPersisted = await persistRefreshFromResponse(response.headers);
  const secureStoreReadBack = Boolean(await getRefreshToken());
  const hasAccessToken = Boolean(response.data?.token);

  logAuthEvent("mfa.verify", {
    hasAccessToken,
    hasRefreshHeader,
    hasSetCookie,
    refreshPersisted,
    secureStoreReadBack,
  });

  if (!hasAccessToken || !response.data?.user) {
    throw normalizeApiError(new Error("MFA succeeded without access token."));
  }

  await persistSession(response.data);

  let refreshEndpointSuccess = false;
  if (secureStoreReadBack) {
    try {
      const refreshed = await refreshSession();
      refreshEndpointSuccess = Boolean(refreshed?.token);
      if (refreshed) return refreshed;
    } catch (error) {
      logAuthEvent("mfa.post.refresh.failed", {
        message: normalizeApiError(error).message,
      });
    }
  }

  logLoginTrace({
    hasAccessToken: true,
    hasRefreshHeader,
    hasSetCookie,
    refreshPersisted,
    secureStoreReadBack: Boolean(await getRefreshToken()),
    refreshEndpointSuccess,
  });

  return response.data;
}
