import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { getJwtSecret } from "../../lib/jwtConfig.js";

/**
 * Google Identity Services "redirect" UX mode (mobile web).
 *
 * The popup mode opens accounts.google.com in a separate tab that must post the credential back to
 * `window.opener`. On mobile browsers (tab discarding, in-app browsers, privacy modes) that hand-back
 * can fail and the Google tab stays blank. In redirect mode Google POSTs the credential to our
 * `login_uri` in the same tab instead.
 *
 * The callback never creates a session itself: it verifies Google's CSRF double-submit cookie and the
 * ID token, then wraps the credential in a short-lived AES-GCM hand-off that the SPA submits to the
 * existing `POST /api/auth/oauth` — so login/sign-up rules, MFA, legal acceptance and errors stay
 * in one place.
 */

export const GOOGLE_REDIRECT_HANDOFF_PREFIX = "gh1.";
export const GOOGLE_REDIRECT_HANDOFF_TTL_MS = 3 * 60 * 1000;
export const GOOGLE_CSRF_COOKIE = "g_csrf_token";

export type GoogleRedirectErrorCode = "csrf" | "missing_credential" | "rejected" | "unavailable" | "rate_limited";

function handoffKey(): Buffer {
  return createHmac("sha256", getJwtSecret()).update("caretip:google-redirect-handoff:v1").digest();
}

export function sealGoogleRedirectHandoff(credential: string, now = Date.now()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", handoffKey(), iv);
  const body = Buffer.from(JSON.stringify({ c: credential, exp: now + GOOGLE_REDIRECT_HANDOFF_TTL_MS }), "utf8");
  const ct = Buffer.concat([cipher.update(body), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${GOOGLE_REDIRECT_HANDOFF_PREFIX}${Buffer.concat([iv, tag, ct]).toString("base64url")}`;
}

export class GoogleRedirectHandoffError extends Error {
  readonly code = "GOOGLE_REDIRECT_HANDOFF_INVALID" as const;
  constructor(readonly reason: "malformed" | "expired") {
    super("Google sign-in expired. Please try again.");
  }
}

export function isGoogleRedirectHandoff(value: string): boolean {
  return value.startsWith(GOOGLE_REDIRECT_HANDOFF_PREFIX);
}

/** Returns the wrapped Google ID token; throws GoogleRedirectHandoffError when tampered or expired. */
export function openGoogleRedirectHandoff(handoff: string, now = Date.now()): string {
  if (!isGoogleRedirectHandoff(handoff)) throw new GoogleRedirectHandoffError("malformed");
  let raw: Buffer;
  try {
    raw = Buffer.from(handoff.slice(GOOGLE_REDIRECT_HANDOFF_PREFIX.length), "base64url");
  } catch {
    throw new GoogleRedirectHandoffError("malformed");
  }
  if (raw.length < 12 + 16 + 2) throw new GoogleRedirectHandoffError("malformed");
  try {
    const decipher = createDecipheriv("aes-256-gcm", handoffKey(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const plain = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
    const parsed = JSON.parse(plain) as { c?: unknown; exp?: unknown };
    if (typeof parsed.c !== "string" || !parsed.c || typeof parsed.exp !== "number") {
      throw new GoogleRedirectHandoffError("malformed");
    }
    if (parsed.exp <= now) throw new GoogleRedirectHandoffError("expired");
    return parsed.c;
  } catch (err) {
    if (err instanceof GoogleRedirectHandoffError) throw err;
    throw new GoogleRedirectHandoffError("malformed");
  }
}

/**
 * SPA landing for the redirect. Relative on purpose: `login_uri` is always on the page origin
 * (Netlify / Vite proxy), so the browser returns to the exact origin it started on — sessionStorage
 * (saved sign-up intent) is per origin, and www/apex/preview hosts must not split the flow.
 * Data travels in the fragment, which browsers never send to servers, proxies or Referer headers;
 * the page strips it from history on load.
 */
export function buildGoogleRedirectCompleteUrl(fragment: { handoff?: string; error?: GoogleRedirectErrorCode }): string {
  const hash = new URLSearchParams();
  if (fragment.handoff) hash.set("handoff", fragment.handoff);
  if (fragment.error) hash.set("error", fragment.error);
  return `/auth/google/complete#${hash.toString()}`;
}
