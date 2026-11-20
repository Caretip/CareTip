/**
 * Decides how the admin dashboard may open a stored file link (logos, verification documents).
 *
 * - "authed": a CareTip API file (page origin, configured API base or legacy API base, path under
 *   /api/ or /uploads/). Only these may be fetched with the user's bearer token and cookies.
 * - "public": a public Supabase Storage object. Opened directly in a new tab, never fetched in the
 *   background and never sent credentials (it is public by design, e.g. business logos).
 * - "refused": anything else. No request is made and no credentials ever leave CareTip.
 *
 * Pure (no window / env access) so it can be tested in isolation; callers pass the origins.
 */
export type FileUrlOrigins = {
  /** window.location.origin (Vite proxy / same-origin API). */
  pageOrigin: string;
  /** Configured API base, e.g. https://api.caretip.de ("" when the API is same-origin). */
  apiBase?: string;
  /** Configured legacy API base (VITE_LEGACY_API_URL; "" when unset). */
  legacyApiBase?: string;
};

export type FileUrlDecision =
  | { kind: "authed"; url: string }
  | { kind: "public"; url: string }
  | { kind: "refused" };

const SUPABASE_PUBLIC_OBJECT_PREFIX = "/storage/v1/object/public/";

function originOf(base: string | undefined): string | null {
  if (!base || !base.trim()) return null;
  try {
    return new URL(base).origin;
  } catch {
    return null;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function classifyFileUrl(raw: string, origins: FileUrlOrigins): FileUrlDecision {
  const input = (raw ?? "").trim();
  if (!input) return { kind: "refused" };

  let parsed: URL;
  try {
    parsed = new URL(input, origins.pageOrigin);
  } catch {
    return { kind: "refused" };
  }

  // Never forward embedded credentials, and only allow web protocols.
  if (parsed.username || parsed.password) return { kind: "refused" };
  const httpsOrLoopback =
    parsed.protocol === "https:" || (parsed.protocol === "http:" && isLoopbackHostname(parsed.hostname));
  if (!httpsOrLoopback) return { kind: "refused" };

  const caretipOrigins = new Set(
    [originOf(origins.pageOrigin), originOf(origins.apiBase), originOf(origins.legacyApiBase)].filter(
      (o): o is string => Boolean(o),
    ),
  );
  const caretipPath = parsed.pathname.startsWith("/api/") || parsed.pathname.startsWith("/uploads/");
  if (caretipOrigins.has(parsed.origin) && caretipPath) {
    return { kind: "authed", url: parsed.href };
  }

  const supabaseHost = parsed.protocol === "https:" && /^[a-z0-9-]+\.supabase\.co$/i.test(parsed.hostname);
  if (supabaseHost && parsed.pathname.startsWith(SUPABASE_PUBLIC_OBJECT_PREFIX)) {
    return { kind: "public", url: parsed.href };
  }

  return { kind: "refused" };
}
