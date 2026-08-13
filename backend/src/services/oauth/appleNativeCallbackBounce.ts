/**
 * Apple form_post bounce for native Android Sign in with Apple.
 *
 * Apple requires an HTTPS Return URL and `response_mode=form_post` when requesting
 * name/email. This handler is NOT a login/session endpoint: it copies `id_token`
 * (and optional name) onto an allowlisted CareTip deep link so the existing
 * POST /api/auth/oauth flow can verify the identity token.
 *
 * Never log id_token, code, user JSON, or the bounce URL.
 */

export const APPLE_NATIVE_CALLBACK_PATH = "/api/auth/apple/native-callback";
export const APPLE_ANDROID_DEEP_LINK_HOST = "apple-auth";

export const APPLE_NATIVE_REDIRECT_SCHEMES = ["caretip", "caretip-dev"] as const;
export type AppleNativeRedirectScheme = (typeof APPLE_NATIVE_REDIRECT_SCHEMES)[number];

const SCHEME_SET = new Set<string>(APPLE_NATIVE_REDIRECT_SCHEMES);

const ANDROID_PACKAGE_BY_SCHEME: Record<AppleNativeRedirectScheme, string> = {
  caretip: "de.caretip.app",
  "caretip-dev": "de.caretip.app.dev",
};

const JWT_LIKE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const NAME_MAX = 120;

export type AppleNativeCallbackFields = {
  id_token?: unknown;
  user?: unknown;
  error?: unknown;
  error_description?: unknown;
  state?: unknown;
};

export type AppleNativeCallbackHtml = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

function firstString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value) && typeof value[0] === "string") return value[0].trim();
  return "";
}

export function schemeFromAppleState(state: string | undefined): AppleNativeRedirectScheme {
  const raw = (state ?? "").trim();
  const scheme = raw.split(".")[0]?.trim() ?? "";
  if (scheme === "caretip-dev") return "caretip-dev";
  if (scheme === "caretip") return "caretip";
  return "caretip";
}

export function isAllowedAppleRedirectScheme(scheme: string): scheme is AppleNativeRedirectScheme {
  return SCHEME_SET.has(scheme);
}

export function appleNameFromUserField(raw: unknown): string | undefined {
  let parsed: unknown = raw;
  if (typeof raw === "string" && raw.trim()) {
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return undefined;
    }
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const name = (parsed as { name?: { firstName?: unknown; lastName?: unknown } }).name;
  if (!name || typeof name !== "object") return undefined;
  const parts = [name.firstName, name.lastName]
    .filter((part): part is string => typeof part === "string" && Boolean(part.trim()))
    .map((part) => part.trim());
  if (parts.length === 0) return undefined;
  const joined = parts.join(" ").slice(0, NAME_MAX);
  return joined || undefined;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function htmlHeaders(): Record<string, string> {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  };
}

function bouncePage(deepLink: string, scheme: AppleNativeRedirectScheme, heading: string, detail: string): string {
  const safeHref = escapeHtml(deepLink);
  const intentHref = escapeHtml(androidIntentFallbackUrl(deepLink, scheme));
  const safeHeading = escapeHtml(heading);
  const safeDetail = escapeHtml(detail);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="0;url=${safeHref}">
<title>CareTip</title>
</head>
<body>
<p>${safeHeading}</p>
<p>${safeDetail}</p>
<p><a href="${safeHref}">Continue to CareTip</a></p>
<p><a href="${intentHref}">Open CareTip</a></p>
<script>location.replace(${JSON.stringify(deepLink)});</script>
</body>
</html>`;
}

export function buildAppleNativeDeepLink(params: {
  scheme: AppleNativeRedirectScheme;
  idToken?: string;
  name?: string;
  error?: string;
  state?: string;
}): string {
  const url = new URL(`${params.scheme}://${APPLE_ANDROID_DEEP_LINK_HOST}`);
  if (params.error) {
    url.searchParams.set("error", params.error);
  } else if (params.idToken) {
    url.searchParams.set("id_token", params.idToken);
    if (params.name) url.searchParams.set("name", params.name);
  }
  if (params.state) url.searchParams.set("state", params.state);
  return url.toString();
}

export function androidIntentFallbackUrl(deepLink: string, scheme: AppleNativeRedirectScheme): string {
  try {
    const parsed = new URL(deepLink);
    const pkg = ANDROID_PACKAGE_BY_SCHEME[scheme];
    const query = parsed.search ? parsed.search.slice(1) : "";
    const path = parsed.hostname || APPLE_ANDROID_DEEP_LINK_HOST;
    const suffix = query ? `?${query}` : "";
    return `intent://${path}${suffix}#Intent;scheme=${scheme};package=${pkg};end`;
  } catch {
    return `${scheme}://${APPLE_ANDROID_DEEP_LINK_HOST}?error=invalid_request`;
  }
}

/**
 * Build the HTML bounce response. Does not verify the Apple JWT — that remains
 * POST /api/auth/oauth + verifyAppleIdentity.
 */
export function buildAppleNativeCallbackHtml(fields: AppleNativeCallbackFields): AppleNativeCallbackHtml {
  try {
    return buildAppleNativeCallbackHtmlUnsafe(fields);
  } catch {
    const deepLink = buildAppleNativeDeepLink({ scheme: "caretip", error: "server_error" });
    return {
      status: 200,
      headers: htmlHeaders(),
      body: bouncePage(
        deepLink,
        "caretip",
        "Returning to CareTip",
        "Apple sign-in did not complete.",
      ),
    };
  }
}

function buildAppleNativeCallbackHtmlUnsafe(fields: AppleNativeCallbackFields): AppleNativeCallbackHtml {
  const state = firstString(fields.state);
  const scheme = schemeFromAppleState(state || undefined);
  const appleError = firstString(fields.error);

  if (appleError) {
    const deepLink = buildAppleNativeDeepLink({
      scheme,
      error: appleError,
      state: state || undefined,
    });
    return {
      status: 200,
      headers: htmlHeaders(),
      body: bouncePage(
        deepLink,
        scheme,
        "Returning to CareTip",
        "Apple sign-in was cancelled or failed.",
      ),
    };
  }

  const idToken = firstString(fields.id_token);
  if (!idToken || !JWT_LIKE.test(idToken)) {
    const deepLink = buildAppleNativeDeepLink({
      scheme,
      error: "invalid_request",
      state: state || undefined,
    });
    return {
      status: 200,
      headers: htmlHeaders(),
      body: bouncePage(
        deepLink,
        scheme,
        "Returning to CareTip",
        "Apple sign-in did not complete.",
      ),
    };
  }

  const name = appleNameFromUserField(fields.user);
  const deepLink = buildAppleNativeDeepLink({
    scheme,
    idToken,
    name,
    state: state || undefined,
  });

  return {
    status: 200,
    headers: htmlHeaders(),
    body: bouncePage(
      deepLink,
      scheme,
      "Returning to CareTip",
      "You can close this window if the app does not open.",
    ),
  };
}

export function androidPackageForScheme(scheme: AppleNativeRedirectScheme): string {
  return ANDROID_PACKAGE_BY_SCHEME[scheme];
}
