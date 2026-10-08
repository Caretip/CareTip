import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildFacebookAuthorizationUrl,
  resolveAllowlistedReturnPath,
  resolveFacebookOAuthRedirectUri,
} from "../src/services/oauth/facebookOAuthRedirect.service.js";
import { refreshCookieName, setRefreshCookie } from "../src/services/refreshToken.service.js";

process.env.FACEBOOK_APP_ID = "1801849467618260";

function withEnv(patch: Record<string, string | undefined>, fn: () => void): void {
  const prev: Record<string, string | undefined> = {};
  for (const key of Object.keys(patch)) {
    prev[key] = process.env[key];
    const value = patch[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(patch)) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  }
}

withEnv(
  {
    NODE_ENV: "production",
    FACEBOOK_OAUTH_REDIRECT_URI: undefined,
    FRONTEND_URL: "https://caretip.de",
    PUBLIC_API_BASE_URL: "https://api.example.com",
  },
  () => {
    assert.equal(
      resolveFacebookOAuthRedirectUri(),
      "https://caretip.de/api/auth/facebook/callback",
    );
  },
);

withEnv(
  {
    NODE_ENV: "development",
    FACEBOOK_OAUTH_REDIRECT_URI: undefined,
    FRONTEND_URL: "http://localhost:5173",
    PUBLIC_API_BASE_URL: "http://localhost:3001",
  },
  () => {
    assert.equal(
      resolveFacebookOAuthRedirectUri(),
      "http://localhost:5173/api/auth/facebook/callback",
    );
  },
);

withEnv(
  {
    NODE_ENV: "development",
    FACEBOOK_OAUTH_REDIRECT_URI: "http://localhost:5173/api/auth/facebook/callback",
    FRONTEND_URL: "http://localhost:5173",
    PUBLIC_API_BASE_URL: "http://localhost:3001",
  },
  () => {
    assert.equal(
      resolveFacebookOAuthRedirectUri(),
      "http://localhost:5173/api/auth/facebook/callback",
    );
  },
);

assert.equal(resolveAllowlistedReturnPath("/dashboard/settings", "link"), "/dashboard/settings");
assert.equal(resolveAllowlistedReturnPath("https://evil.com/x", "login"), "/login");
assert.equal(resolveAllowlistedReturnPath("/evil", "signup"), "/login");

withEnv(
  {
    NODE_ENV: "production",
    FACEBOOK_OAUTH_REDIRECT_URI: undefined,
    FRONTEND_URL: "https://caretip.de",
    PUBLIC_API_BASE_URL: "https://api.example.com",
  },
  () => {
    const prodCallback = "https://caretip.de/api/auth/facebook/callback";
    const url = buildFacebookAuthorizationUrl("state_test_123");
    assert.ok(url.includes("facebook.com"));
    assert.ok(url.includes("client_id=1801849467618260"));
    assert.ok(url.includes("state=state_test_123"));
    assert.ok(url.includes("response_type=code"));
    assert.ok(url.includes("email"));
    assert.ok(url.includes(encodeURIComponent(prodCallback)));
  },
);

withEnv(
  {
    NODE_ENV: "development",
    FACEBOOK_OAUTH_REDIRECT_URI: undefined,
    FRONTEND_URL: "http://localhost:5173",
    PUBLIC_API_BASE_URL: "http://localhost:3001",
  },
  () => {
    const url = buildFacebookAuthorizationUrl("state_local");
    assert.ok(
      url.includes(encodeURIComponent("http://localhost:5173/api/auth/facebook/callback")),
    );
  },
);

withEnv(
  {
    NODE_ENV: "production",
    FACEBOOK_OAUTH_REDIRECT_URI: "https://api.example.com/api/auth/facebook/callback",
    FRONTEND_URL: "https://caretip.de",
    PUBLIC_API_BASE_URL: "https://api.example.com",
  },
  () => {
    assert.equal(
      resolveFacebookOAuthRedirectUri(),
      "https://caretip.de/api/auth/facebook/callback",
    );
  },
);

withEnv(
  {
    NODE_ENV: "production",
    FACEBOOK_OAUTH_REDIRECT_URI: "https://staging.caretip.de/api/auth/facebook/callback",
    FRONTEND_URL: "https://caretip.de",
    PUBLIC_API_BASE_URL: "https://api.example.com",
  },
  () => {
    assert.equal(
      resolveFacebookOAuthRedirectUri(),
      "https://staging.caretip.de/api/auth/facebook/callback",
    );
  },
);

function captureRefreshCookie(nodeEnv: "production" | "development") {
  let captured: { name: string; opts: Record<string, unknown> } | null = null;
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = nodeEnv;
  try {
    setRefreshCookie(
      {
        cookie(name, _value, opts) {
          captured = { name, opts };
        },
      },
      "placeholder",
    );
  } finally {
    if (prev === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prev;
  }
  assert.ok(captured);
  return captured;
}

const prodCookie = captureRefreshCookie("production");
assert.equal(prodCookie.name, refreshCookieName());
assert.equal(prodCookie.opts.httpOnly, true);
assert.equal(prodCookie.opts.secure, true);
assert.equal(prodCookie.opts.sameSite, "none");
assert.equal(prodCookie.opts.path, "/");
assert.equal("domain" in prodCookie.opts, false);

const devCookie = captureRefreshCookie("development");
assert.equal(devCookie.opts.httpOnly, true);
assert.equal(devCookie.opts.secure, false);
assert.equal(devCookie.opts.sameSite, "lax");
assert.equal(devCookie.opts.path, "/");
assert.equal("domain" in devCookie.opts, false);

const redirectsPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../public/_redirects");
const redirects = readFileSync(redirectsPath, "utf8");
const proxyRule = redirects
  .split(/\r?\n/)
  .map((line) => line.trim())
  .find((line) => line.startsWith("/api/*"));
assert.ok(proxyRule, "Netlify /api/* proxy rule missing");
assert.match(proxyRule!, /^\/api\/\*\s+https:\/\/caretip\.onrender\.com\/api\/:splat\s+200\s*$/);

function proxyMatches(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

assert.equal(proxyMatches("/api/auth/facebook/callback"), true);
assert.equal(proxyMatches("/api/auth/refresh"), true);

/** Attribute names only — never print a cookie value. */
function setCookieAttributeNames(header: string): string[] {
  return header
    .split(";")
    .slice(1)
    .map((part) => part.trim().split("=")[0]?.toLowerCase())
    .filter((name): name is string => Boolean(name));
}

const upstreamSetCookie =
  "caretip_refresh=placeholder; HttpOnly; Secure; SameSite=None; Path=/";
const proxiedSetCookie = upstreamSetCookie;
assert.ok(proxiedSetCookie.toLowerCase().startsWith("caretip_refresh="));
const attrs = setCookieAttributeNames(proxiedSetCookie);
assert.ok(attrs.includes("httponly"));
assert.ok(attrs.includes("secure"));
assert.ok(attrs.includes("samesite"));
assert.ok(attrs.includes("path"));
assert.equal(attrs.includes("domain"), false);

console.log("facebook-oauth-redirect-runtime: all passed");
