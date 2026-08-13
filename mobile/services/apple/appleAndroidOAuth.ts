/**
 * Android web OAuth helpers for Sign in with Apple.
 * Pure functions (no React Native) so Node runtime tests can import them.
 *
 * Apple Return URLs must be HTTPS — never caretip://. The API bounce copies
 * the identity token onto the existing app scheme.
 */

import { AppleSignInCancelledError, AppleSignInUnavailableError } from "./appleSignInErrors";

export const APPLE_AUTHORIZE_URL = "https://appleid.apple.com/auth/authorize";
export const APPLE_ANDROID_CALLBACK_PATH = "/api/auth/apple/native-callback";
export const APPLE_ANDROID_DEEP_LINK_PATH = "apple-auth";

export const APPLE_NATIVE_SCHEMES = ["caretip", "caretip-dev"] as const;
export type AppleNativeScheme = (typeof APPLE_NATIVE_SCHEMES)[number];

const JWT_LIKE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const BLOCKED_CLIENT_IDS = new Set(["undefined", "null", "true", "false"]);

export function resolveAppleNativeScheme(raw: string | string[] | null | undefined): AppleNativeScheme {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value === "string" && value.trim() === "caretip-dev") return "caretip-dev";
  return "caretip";
}

export function encodeAppleAndroidState(scheme: AppleNativeScheme, nonce: string): string {
  return `${scheme}.${nonce}`;
}

/**
 * Public Apple Services ID shape only — never treat empty/placeholder values as configured.
 * Does not contact Apple.
 */
export function isAppleServicesIdShapeValid(value: string | null | undefined): value is string {
  if (typeof value !== "string") return false;
  const id = value.trim();
  if (id.length < 3 || id.length > 128) return false;
  if (BLOCKED_CLIENT_IDS.has(id.toLowerCase())) return false;
  if (id.includes("://") || /\s/.test(id)) return false;
  return /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(id);
}

export function appleAndroidRedirectUri(apiUrl: string): string {
  const base = typeof apiUrl === "string" ? apiUrl.replace(/\/+$/, "") : "";
  return `${base}${APPLE_ANDROID_CALLBACK_PATH}`;
}

export function isHttpsAppleRedirectUri(redirectUri: string): boolean {
  if (typeof redirectUri !== "string" || !redirectUri.startsWith("https://")) return false;
  try {
    const parsed = new URL(redirectUri);
    return parsed.protocol === "https:" && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

export function buildAppleAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
}): string {
  if (!isAppleServicesIdShapeValid(params.clientId)) {
    throw new AppleSignInUnavailableError("Apple Sign-In is not configured.");
  }
  if (!isHttpsAppleRedirectUri(params.redirectUri)) {
    throw new AppleSignInUnavailableError("Apple Sign-In is not configured.");
  }
  if (typeof params.state !== "string" || !params.state.trim()) {
    throw new AppleSignInUnavailableError("Apple Sign-In is not configured.");
  }
  if (typeof params.nonce !== "string" || !params.nonce.trim()) {
    throw new AppleSignInUnavailableError("Apple Sign-In is not configured.");
  }

  const url = new URL(APPLE_AUTHORIZE_URL);
  url.searchParams.set("client_id", params.clientId.trim());
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code id_token");
  url.searchParams.set("response_mode", "form_post");
  url.searchParams.set("scope", "name email");
  url.searchParams.set("state", params.state.trim());
  url.searchParams.set("nonce", params.nonce.trim());
  return url.toString();
}

export function appleAndroidDeepLinkPrefix(scheme: AppleNativeScheme): string {
  return `${scheme}://${APPLE_ANDROID_DEEP_LINK_PATH}`;
}

/** True when a URL is the Apple Android bounce deep link (do not route it as a screen). */
export function isAppleAndroidCallbackUrl(url: string | null | undefined): boolean {
  if (typeof url !== "string" || !url.trim()) return false;
  const lower = url.toLowerCase();
  return (
    lower.includes("://apple-auth") ||
    lower.includes("://apple-auth?") ||
    /(?:^|[/?#])apple-auth(?:[/?#]|$)/.test(lower)
  );
}

function firstParam(params: URLSearchParams, key: string): string {
  const raw = params.get(key);
  return typeof raw === "string" ? raw.trim() : "";
}

/**
 * Parse the CareTip deep-link that the API bounce issues after Apple form_post.
 * Never assumes id_token exists. Does not log the URL or token.
 */
export function parseAppleAuthCallbackUrl(url: string): { idToken: string; fullName?: string } {
  if (typeof url !== "string" || !url.trim()) {
    throw new AppleSignInUnavailableError("Apple sign-in did not return a valid callback.");
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AppleSignInUnavailableError("Apple sign-in did not return a valid callback.");
  }

  const error = firstParam(parsed.searchParams, "error");
  if (error === "user_cancelled_authorize" || error === "user_cancelled") {
    throw new AppleSignInCancelledError();
  }
  if (error) {
    throw new AppleSignInUnavailableError("Apple sign-in failed.");
  }

  const idToken = firstParam(parsed.searchParams, "id_token");
  if (!idToken || !JWT_LIKE.test(idToken)) {
    throw new AppleSignInUnavailableError("Apple did not return an identity token.");
  }

  const name = firstParam(parsed.searchParams, "name");
  return { idToken, fullName: name || undefined };
}
