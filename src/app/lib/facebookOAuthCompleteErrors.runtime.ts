/**
 * Run: npm run test:facebook-oauth-complete-errors
 */
import assert from "node:assert/strict";
import {
  facebookOAuthCompleteErrorMessageKey,
  facebookOAuthCompleteErrorTitleKey,
} from "./facebookOAuthCompleteErrors";
import { FACEBOOK_OAUTH_START_FAILED_ERROR } from "./facebookOAuthRedirectWeb";

assert.equal(
  facebookOAuthCompleteErrorMessageKey("account_exists"),
  "auth.oauth.facebookRedirectAccountExists",
);
assert.equal(
  facebookOAuthCompleteErrorTitleKey("query", "account_exists"),
  "auth.oauth.facebookRedirectAccountExistsTitle",
);
assert.equal(
  facebookOAuthCompleteErrorMessageKey("already_processed"),
  "auth.oauth.facebookRedirectAlreadyProcessed",
);
assert.equal(
  facebookOAuthCompleteErrorMessageKey("state_invalid"),
  "auth.oauth.facebookRedirectStateInvalid",
);
assert.equal(
  facebookOAuthCompleteErrorMessageKey("unknown_code"),
  "auth.oauth.facebookRedirectFailed",
);
assert.equal(
  facebookOAuthCompleteErrorTitleKey("query", FACEBOOK_OAUTH_START_FAILED_ERROR),
  "auth.oauth.facebookRedirectStartErrorTitle",
);

console.log("facebook-oauth-complete-errors: all passed");
