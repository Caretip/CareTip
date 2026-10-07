import assert from "node:assert/strict";
import {
  buildFacebookAuthorizationUrl,
  resolveAllowlistedReturnPath,
  resolveFacebookOAuthRedirectUri,
} from "../src/services/oauth/facebookOAuthRedirect.service.js";

process.env.FACEBOOK_APP_ID = "1801849467618260";
process.env.PUBLIC_API_BASE_URL = "https://api.example.com";

assert.equal(resolveFacebookOAuthRedirectUri(), "https://api.example.com/api/auth/facebook/callback");

assert.equal(resolveAllowlistedReturnPath("/dashboard/settings", "link"), "/dashboard/settings");
assert.equal(resolveAllowlistedReturnPath("https://evil.com/x", "login"), "/login");
assert.equal(resolveAllowlistedReturnPath("/evil", "signup"), "/login");

const url = buildFacebookAuthorizationUrl("state_test_123");
assert.ok(url.includes("facebook.com"));
assert.ok(url.includes("client_id=1801849467618260"));
assert.ok(url.includes("state=state_test_123"));
assert.ok(url.includes("response_type=code"));
assert.ok(url.includes("email"));
assert.ok(url.includes(encodeURIComponent("https://api.example.com/api/auth/facebook/callback")));

console.log("facebook-oauth-redirect-runtime: all passed");
