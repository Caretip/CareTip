import { config } from "@/constants/config";

/**
 * Resolve API-relative media paths (`/uploads/...`) against `EXPO_PUBLIC_API_URL`.
 * Absolute https URLs (Supabase public) pass through unchanged.
 */
export function resolveMediaUrl(url: string | null | undefined): string | undefined {
  if (url == null) return undefined;
  const s = String(url).trim();
  if (!s) return undefined;

  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("data:") || s.startsWith("file:")) return s;

  const base = config.apiUrl.replace(/\/$/, "");
  if (s.startsWith("/")) return base ? `${base}${s}` : s;
  if (/^uploads\//i.test(s)) {
    const withSlash = `/${s}`;
    return base ? `${base}${withSlash}` : withSlash;
  }
  return s;
}

/** Optional `?v=` bust so RN image cache refreshes after replace-upload. */
export function withMediaCacheBust(
  url: string | undefined,
  bust?: number | string | null,
): string | undefined {
  if (!url) return undefined;
  if (bust == null || bust === "" || bust === 0 || bust === "0") return url;
  if (url.startsWith("data:")) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}v=${bust}`;
}

export function isUsableMediaUrl(url: string | null | undefined): boolean {
  return Boolean(resolveMediaUrl(url));
}
