import { resolveApiBaseUrl } from "./apiOrigin";
import { isBrokenLegacyApiDiskMediaUrl } from "./mediaPathKind";
import { normalizeSupabasePublicStorageUrl } from "./normalizeSupabaseStorageUrl";

/**
 * Turns API-relative media paths (`/uploads/...`) into absolute URLs for `<img src>`.
 * Browsers resolve relative paths against the page origin, not the API — so stored paths break on static hosts.
 *
 * In dev, absolute URLs like `http://localhost:3001/uploads/...` are normalized to `/uploads/...` so the
 * Vite proxy serves them from the SPA origin (avoids broken avatars when the API returns a different host/port).
 */
export function resolveMediaUrl(url: string | null | undefined): string | undefined {
  if (url == null || String(url).trim() === "") return undefined;
  const s = String(url).trim();

  if (isBrokenLegacyApiDiskMediaUrl(s)) {
    return undefined;
  }

  if (/^https?:\/\//i.test(s)) {
    try {
      const parsed = new URL(s);
      if (parsed.pathname.startsWith("/uploads/") && typeof import.meta.env !== "undefined" && import.meta.env.DEV) {
        return `${parsed.pathname}${parsed.search}`;
      }
    } catch {
      return normalizeSupabasePublicStorageUrl(s);
    }
    return normalizeSupabasePublicStorageUrl(s);
  }

  const base = resolveApiBaseUrl().replace(/\/$/, "");
  if (s.startsWith("/")) {
    // Vite-built assets (/assets/*) and other frontend static paths must stay on the SPA origin.
    // Only `/uploads/*` is served by the API and needs the cross-origin base in production.
    if (!s.startsWith("/uploads/")) {
      return s;
    }
    return base ? `${base}${s}` : s;
  }
  if (/^uploads\//i.test(s)) {
    const withSlash = `/${s}`;
    return base ? `${base}${withSlash}` : withSlash;
  }
  return s;
}

/**
 * Optional cache-bust query for the same stored path (e.g. after re-upload).
 * Skips `?v=` when `bust` is 0 so all components share one URL and avoid duplicate/aborted fetches.
 */
export function withMediaCacheBust(url: string | undefined, bust: number): string | undefined {
  if (!url || bust <= 0) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}v=${bust}`;
}
