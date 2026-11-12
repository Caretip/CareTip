/**
 * Google sign-in UX mode for the web SPA.
 *
 * Popup mode (GIS default) opens accounts.google.com in a separate window/tab that hands the
 * credential back through `window.opener`. On phones that hand-back is unreliable (tab discarding,
 * in-app browsers, privacy modes) and the Google tab can stay blank. Redirect mode keeps the whole
 * flow in one tab: Google POSTs to `/api/auth/google/redirect` on this origin, which hands a sealed,
 * short-lived credential back to `/auth/google/complete`.
 *
 * `VITE_GOOGLE_OAUTH_UX_MODE`:
 *  - `popup` (default) — unchanged behaviour.
 *  - `auto` — redirect on touch/mobile browsers, popup on desktop.
 *  - `redirect` — always redirect.
 * Redirect requires `<origin>/api/auth/google/redirect` to be listed under "Authorized redirect URIs"
 * of the Google OAuth client, and `/api` to be served on the page origin (Netlify / Vite proxy).
 */

export type GoogleOAuthUxMode = "popup" | "redirect";

const INTENT_KEY = "caretip_google_redirect_intent";
const HANDOFF_KEY = "caretip_google_redirect_handoff";
/** Matches the backend hand-off TTL. */
export const GOOGLE_REDIRECT_HANDOFF_MAX_AGE_MS = 3 * 60 * 1000;

export type GoogleRedirectIntent = {
  isLogin: boolean;
  returnPath: string;
  intendedRole?: "MANAGER" | "EMPLOYEE";
  name?: string;
  inviteCode?: string;
  merchantLegalAccepted?: boolean;
  savedAt: number;
};

function configuredMode(): "popup" | "redirect" | "auto" {
  const raw = String(import.meta.env.VITE_GOOGLE_OAUTH_UX_MODE ?? "").trim().toLowerCase();
  if (raw === "redirect" || raw === "auto") return raw;
  return "popup";
}

export function isMobileWebClient(nav: Pick<Navigator, "userAgent"> | undefined = typeof navigator === "undefined" ? undefined : navigator): boolean {
  if (!nav) return false;
  if (/Android|iPhone|iPad|iPod|Mobile|FBAN|FBAV|Instagram|Line\//i.test(nav.userAgent)) return true;
  try {
    return typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches === true;
  } catch {
    return false;
  }
}

export function resolveGoogleOAuthUxMode(): GoogleOAuthUxMode {
  const mode = configuredMode();
  if (mode === "redirect") return "redirect";
  if (mode === "auto" && isMobileWebClient()) return "redirect";
  return "popup";
}

export function googleRedirectLoginUri(): string {
  return `${window.location.origin}/api/auth/google/redirect`;
}

function safeStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Saved whenever the auth form context changes, so it survives the full-page redirect. */
export function saveGoogleRedirectIntent(intent: Omit<GoogleRedirectIntent, "savedAt">): void {
  try {
    safeStorage()?.setItem(INTENT_KEY, JSON.stringify({ ...intent, savedAt: Date.now() }));
  } catch {
    /* storage blocked: redirect still works for login; sign-up falls back to the form defaults */
  }
}

export function readGoogleRedirectIntent(): GoogleRedirectIntent | null {
  try {
    const raw = safeStorage()?.getItem(INTENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GoogleRedirectIntent;
    return typeof parsed?.isLogin === "boolean" && typeof parsed.returnPath === "string" ? parsed : null;
  } catch {
    return null;
  }
}

/** Only same-app auth paths are allowed as a return target (no open redirect). */
export function resolveGoogleRedirectReturnPath(intent: GoogleRedirectIntent | null): string {
  const raw = intent?.returnPath ?? "/login";
  const path = raw.split("#")[0] ?? "/login";
  const allowed = /^\/(login|signup|auth|employee\/login|join)(\/[A-Za-z0-9_-]+)*(\?[^#]*)?$/.test(path);
  if (!allowed || path.startsWith("/auth/google") || path.startsWith("/auth/facebook")) {
    return intent?.isLogin === false ? "/signup" : "/login";
  }
  return path;
}

export function storeGoogleRedirectHandoff(handoff: string): void {
  try {
    safeStorage()?.setItem(HANDOFF_KEY, JSON.stringify({ handoff, at: Date.now() }));
  } catch {
    /* ignored: the auth page will show the normal sign-in form */
  }
}

/** One-shot: returns a fresh hand-off and removes it, so a refresh or back never replays it. */
export function takeGoogleRedirectHandoff(now = Date.now()): string | null {
  const storage = safeStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(HANDOFF_KEY);
    storage.removeItem(HANDOFF_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { handoff?: unknown; at?: unknown };
    if (typeof parsed.handoff !== "string" || typeof parsed.at !== "number") return null;
    if (now - parsed.at > GOOGLE_REDIRECT_HANDOFF_MAX_AGE_MS) return null;
    return parsed.handoff;
  } catch {
    return null;
  }
}

export function hasPendingGoogleRedirectHandoff(): boolean {
  try {
    return Boolean(safeStorage()?.getItem(HANDOFF_KEY));
  } catch {
    return false;
  }
}

/** Parses `#handoff=…` / `#error=…` set by the backend redirect. */
export function parseGoogleRedirectFragment(hash: string): { handoff: string | null; error: string | null } {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const handoff = params.get("handoff");
  const error = params.get("error");
  return {
    handoff: handoff && handoff.startsWith("gh1.") ? handoff : null,
    error: error && /^[a-z_]{1,40}$/.test(error) ? error : null,
  };
}
