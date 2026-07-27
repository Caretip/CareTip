/**
 * Parse refresh token from auth responses.
 * Web uses HttpOnly Set-Cookie; React Native often cannot read Set-Cookie,
 * so the backend also mirrors the same opaque token in X-CareTip-Refresh.
 */

const REFRESH_COOKIE_NAME = "caretip_refresh";
const REFRESH_HEADER_NAME = "x-caretip-refresh";

function asHeaderRecord(headers: unknown): Record<string, unknown> | undefined {
  if (!headers || typeof headers !== "object") return undefined;

  const maybeAxios = headers as {
    toJSON?: () => Record<string, unknown>;
    get?: (name: string) => unknown;
  };

  if (typeof maybeAxios.toJSON === "function") {
    return maybeAxios.toJSON();
  }

  return headers as Record<string, unknown>;
}

export function extractRefreshTokenFromSetCookie(
  setCookieHeader: string | string[] | undefined,
): string | null {
  if (!setCookieHeader) return null;
  const headers = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];

  for (const header of headers) {
    const match = header.match(new RegExp(`(?:^|,\\s*|\\n)${REFRESH_COOKIE_NAME}=([^;\\s,]+)`, "i"));
    if (match?.[1] && match[1] !== "deleted" && match[1] !== "") {
      return decodeURIComponent(match[1]);
    }
    if (header.startsWith(`${REFRESH_COOKIE_NAME}=`)) {
      const value = header.slice(REFRESH_COOKIE_NAME.length + 1).split(";")[0]?.trim();
      if (value && value !== "deleted") return decodeURIComponent(value);
    }
  }
  return null;
}

export function extractRefreshTokenFromHeaders(headers: unknown): string | null {
  const record = asHeaderRecord(headers);
  if (!record) {
    // AxiosHeaders.get fallback when toJSON is unavailable
    const getter = (headers as { get?: (name: string) => unknown } | null)?.get;
    if (typeof getter === "function") {
      const viaGet = getter.call(headers, "x-caretip-refresh") ?? getter.call(headers, "X-CareTip-Refresh");
      if (typeof viaGet === "string" && viaGet.trim() && viaGet.trim() !== "deleted") {
        return viaGet.trim();
      }
    }
    return null;
  }

  const setCookie =
    (record["set-cookie"] as string | string[] | undefined) ??
    (record["Set-Cookie"] as string | string[] | undefined);
  const fromCookie = extractRefreshTokenFromSetCookie(setCookie);
  if (fromCookie) return fromCookie;

  const raw =
    record[REFRESH_HEADER_NAME] ??
    record["X-CareTip-Refresh"] ??
    record["x-CareTip-Refresh"];
  if (typeof raw === "string" && raw.trim() && raw.trim() !== "deleted") {
    return raw.trim();
  }
  if (Array.isArray(raw) && typeof raw[0] === "string" && raw[0].trim()) {
    return raw[0].trim();
  }

  const getter = (headers as { get?: (name: string) => unknown } | null)?.get;
  if (typeof getter === "function") {
    const viaGet = getter.call(headers, "x-caretip-refresh") ?? getter.call(headers, "X-CareTip-Refresh");
    if (typeof viaGet === "string" && viaGet.trim() && viaGet.trim() !== "deleted") {
      return viaGet.trim();
    }
  }

  return null;
}

export function buildRefreshCookieHeader(refreshToken: string): string {
  return `${REFRESH_COOKIE_NAME}=${refreshToken}`;
}

export { REFRESH_COOKIE_NAME, REFRESH_HEADER_NAME };
