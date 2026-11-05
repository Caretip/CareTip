/**
 * Normalizes `VITE_API_URL` when hosts (e.g. Netlify) store a full `.env` line or other junk in the value.
 * Wrong: `VITE_API_URL=https://api.example.com` → browser would request `/VITE_API_URL=https://...` (404).
 */

let devProxyWarned = false;

function sanitizeApiBaseInput(raw: string): string {
  let s = raw.trim().replace(/\/+$/, "");
  if (!s) return "";
  if (s.toUpperCase().startsWith("VITE_API_URL=")) {
    s = s.slice("VITE_API_URL=".length).trim().replace(/\/+$/, "");
  }
  const m = s.match(/https?:\/\/[^\s"'`]+/i);
  if (m && m.index !== undefined && m.index > 0) {
    s = m[0].trim().replace(/\/+$/, "");
  }
  return s;
}

function requireHttpBase(s: string): string {
  if (!s) return "";
  const t = s.trim().replace(/\/+$/, "");
  if (/^https?:\/\//i.test(t)) return t;
  if (typeof import.meta !== "undefined" && import.meta.env?.DEV) {
    console.warn(
      `[Caretip] VITE_API_URL must be an absolute http(s) URL after normalization. Got: "${s.slice(0, 120)}"`
    );
  }
  return "";
}

function isLoopbackHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

/**
 * Resolves the REST/Socket API base URL.
 *
 * **Local dev:** Always use same-origin `/api` (Vite proxy) on loopback so the httpOnly
 * refresh cookie is set for the page origin (5173). Calling `http://localhost:3001` directly
 * breaks refresh (cross-port cookies / SameSite).
 *
 * **Production:** Use `VITE_API_URL` when set (cross-origin API with `credentials: "include"`).
 */
export function resolveApiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_URL;
  const configured =
    typeof raw === "string" && raw.trim() !== ""
      ? requireHttpBase(sanitizeApiBaseInput(raw))
      : "";

  if (typeof window === "undefined") {
    return configured;
  }

  if (import.meta.env.DEV && isLoopbackHost(window.location.hostname)) {
    if (configured && !devProxyWarned) {
      devProxyWarned = true;
      console.info(
        "[Caretip] Local dev uses the Vite proxy (/api → :3001) so auth cookies persist on refresh. " +
          "Unset VITE_API_URL in .env.local or ignore this if you only use it for non-browser tools."
      );
    }
    return "";
  }

  const host = window.location.hostname;

  if (import.meta.env.DEV && configured && /\b(localhost|127\.0\.0\.1)\b/i.test(configured)) {
    if (!devProxyWarned) {
      devProxyWarned = true;
      console.warn(
        `[Caretip] VITE_API_URL (${configured}) points at localhost but the app is opened from "${host}". ` +
          "Using same-origin /api (Vite proxy) so refresh cookies work."
      );
    }
    return "";
  }

  return configured;
}

/**
 * Previous API origin during an API-hostname migration (`VITE_LEGACY_API_URL`), used only to move
 * existing browser sessions to the current API host once. Empty when unset, invalid, or equal to
 * the current API base.
 */
export function resolveLegacyApiBaseUrl(): string {
  const raw = import.meta.env.VITE_LEGACY_API_URL;
  if (typeof raw !== "string" || raw.trim() === "") return "";
  const legacy = requireHttpBase(sanitizeApiBaseInput(raw));
  if (!legacy) return "";
  const current = resolveApiBaseUrl();
  if (!current || current === legacy) return "";
  return legacy;
}

/** True when API calls are cross-origin (production API URL); enables cold-start retry. */
export function isCrossOriginCaretipApi(): boolean {
  return Boolean(resolveApiBaseUrl());
}
