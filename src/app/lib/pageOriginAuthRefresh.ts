/**
 * Facebook redirect OAuth stores the host-only refresh cookie on the page origin
 * (Vite in dev, Netlify `/api/*` in production). That session must refresh through
 * the same origin. Other browser sessions still refresh via `VITE_API_URL`.
 */

export const AUTH_REFRESH_PATHNAME = "/api/auth/refresh";

const PAGE_ORIGIN_REFRESH_STORAGE_KEY = "caretip_page_origin_refresh";

export function preferPageOriginAuthRefresh(): void {
  try {
    localStorage.setItem(PAGE_ORIGIN_REFRESH_STORAGE_KEY, "1");
  } catch {
    /* private mode */
  }
}

export function clearPageOriginAuthRefresh(): void {
  try {
    localStorage.removeItem(PAGE_ORIGIN_REFRESH_STORAGE_KEY);
  } catch {
    /* private mode */
  }
}

export function isPageOriginAuthRefreshPreferred(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(PAGE_ORIGIN_REFRESH_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Same-origin `/api/auth/refresh` when this browser's refresh cookie lives on the page host. */
export function resolveBrowserAuthRefreshUrl(apiBaseUrl: string, pageOriginPreferred?: boolean): string {
  const prefer = pageOriginPreferred ?? isPageOriginAuthRefreshPreferred();
  if (prefer) return AUTH_REFRESH_PATHNAME;
  const base = apiBaseUrl.trim().replace(/\/$/, "");
  return base ? `${base}${AUTH_REFRESH_PATHNAME}` : AUTH_REFRESH_PATHNAME;
}
