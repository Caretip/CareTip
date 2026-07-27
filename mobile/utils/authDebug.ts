/**
 * Dev-only auth lifecycle logging for Phase 3.5.6 / 3.5.7 session audit.
 * Never logs full token values.
 */

function maskSecret(value: string | null | undefined): string {
  if (!value) return "(none)";
  if (value.length <= 12) return `(len=${value.length})`;
  return `${value.slice(0, 6)}…${value.slice(-4)} (len=${value.length})`;
}

export function logAuthEvent(
  event: string,
  details: Record<string, unknown> = {},
): void {
  if (!__DEV__) return;
  console.log(`[CareTip][Auth] ${event}`, details);
}

export function logAuthTokenState(label: string, token: string | null | undefined): void {
  logAuthEvent(label, { accessToken: maskSecret(token) });
}

export function logOutgoingAuthHeader(hasBearer: boolean, token: string | null): void {
  logAuthEvent("outgoing.request", {
    authorization: hasBearer ? `Bearer ${maskSecret(token)}` : "(missing)",
  });
}

/** Flatten Axios / fetch headers for device-side inspection. */
export function serializeResponseHeaders(headers: unknown): Record<string, string> {
  if (!headers || typeof headers !== "object") return {};

  const maybeAxios = headers as {
    toJSON?: () => Record<string, unknown>;
    get?: (name: string) => string | null | undefined;
  };

  if (typeof maybeAxios.toJSON === "function") {
    const json = maybeAxios.toJSON();
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(json)) {
      if (value == null) continue;
      out[key] = Array.isArray(value) ? value.join(", ") : String(value);
    }
    return out;
  }

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (value == null) continue;
    out[key] = Array.isArray(value) ? value.map(String).join(", ") : String(value);
  }
  return out;
}

export function headerLookup(
  headers: Record<string, string>,
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower && value.trim()) return value.trim();
  }
  return undefined;
}

export type LoginTraceFlags = {
  hasAccessToken: boolean;
  hasRefreshHeader: boolean;
  hasSetCookie: boolean;
  refreshPersisted: boolean;
  secureStoreReadBack: boolean;
  refreshEndpointSuccess: boolean;
};

export function logLoginTrace(flags: LoginTraceFlags): void {
  logAuthEvent("LOGIN_TRACE", {
    step: [
      "Login",
      flags.hasAccessToken ? "Access token received" : "Access token MISSING",
      flags.hasRefreshHeader
        ? "Refresh header received"
        : flags.hasSetCookie
          ? "Refresh via Set-Cookie only"
          : "Refresh header MISSING",
      flags.refreshPersisted ? "Refresh stored" : "Refresh NOT stored",
      flags.secureStoreReadBack ? "SecureStore read-back OK" : "SecureStore read-back FAIL",
      flags.refreshEndpointSuccess ? "Refresh endpoint success" : "Refresh endpoint FAIL",
      "Dashboard next",
    ].join(" → "),
    hasAccessToken: flags.hasAccessToken,
    hasRefreshHeader: flags.hasRefreshHeader,
    hasSetCookie: flags.hasSetCookie,
    refreshPersisted: flags.refreshPersisted,
    secureStoreReadBack: flags.secureStoreReadBack,
    refreshEndpointSuccess: flags.refreshEndpointSuccess,
  });
}
