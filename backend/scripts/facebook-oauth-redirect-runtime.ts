import assert from "node:assert/strict";
import {
  buildFacebookAuthorizationUrl,
  resolveAllowlistedReturnPath,
  resolveFacebookOAuthRedirectUri,
} from "../src/services/oauth/facebookOAuthRedirect.service.js";

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
      "https://api.example.com/api/auth/facebook/callback",
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
    const prodCallback = "https://api.example.com/api/auth/facebook/callback";
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

console.log("facebook-oauth-redirect-runtime: all passed");
