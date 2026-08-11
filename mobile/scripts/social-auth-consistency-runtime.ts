/**
 * Social auth login/signup consistency + friendly error mapping.
 *
 *   npm run test:social-auth
 *   npx tsx scripts/social-auth-consistency-runtime.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleSignInCancelledError } from "../services/google/googleSignInErrors";
import { AppleSignInCancelledError } from "../services/apple/appleSignInErrors";
import { FacebookSignInCancelledError } from "../services/facebook/facebookSignInErrors";
import {
  resolveOAuthErrorMessage,
  isOAuthAccountNotRegistered,
} from "../utils/oauthErrorMessage";
import {
  oauthPayloadForMode,
  shouldRenderSocialAuthRow,
  socialProvidersForPlatform,
} from "../utils/socialAuthUiPolicy";
import type { NormalizedApiError } from "../types/api";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.join(__dirname, "..");

const t = (key: string) => key;

function normalized(code: string, message: string, status = 400): NormalizedApiError {
  return {
    status,
    message,
    code,
    isNetworkError: false,
    isTimeout: false,
    isUnauthorized: status === 401,
  };
}

function runPolicy(): void {
  assert.equal(shouldRenderSocialAuthRow(), true);
  assert.deepEqual(socialProvidersForPlatform("ios"), ["apple", "google", "facebook"]);
  assert.deepEqual(socialProvidersForPlatform("android"), ["google", "facebook", "apple"]);
  assert.deepEqual(socialProvidersForPlatform("web"), ["google", "facebook", "apple"]);
  assert.deepEqual(oauthPayloadForMode(true, "MANAGER"), { isLogin: true });
  assert.deepEqual(oauthPayloadForMode(false, "MANAGER"), {
    isLogin: false,
    intendedRole: "MANAGER",
  });
  assert.deepEqual(oauthPayloadForMode(false, "EMPLOYEE"), {
    isLogin: false,
    intendedRole: "EMPLOYEE",
  });
}

function runSourceConsistency(): void {
  const login = fs.readFileSync(path.join(mobileRoot, "features/auth/LoginScreen.tsx"), "utf8");
  const sheet = fs.readFileSync(
    path.join(mobileRoot, "components/auth/AuthRegisterSheet.tsx"),
    "utf8",
  );

  assert.match(login, /SocialAuthButtons/);
  assert.match(sheet, /SocialAuthButtons/);
  assert.doesNotMatch(login, /anySocialConfigured\s*\?/);
  assert.match(login, /runSocialAuth\(provider,\s*\{\s*isLogin:\s*true/);
  assert.match(sheet, /onContinueWithProvider/);
  assert.match(
    login,
    /runSocialAuth\(provider,\s*\{\s*isLogin:\s*false,\s*intendedRole:\s*"MANAGER"/,
  );
}

function runErrorMapping(): void {
  const googleCancel = resolveOAuthErrorMessage(new GoogleSignInCancelledError(), t, "google");
  assert.equal(googleCancel, "auth.googleSignInCancelled");
  assert.doesNotMatch(googleCancel, /OAuthAccountNotFound/i);

  assert.equal(
    resolveOAuthErrorMessage(new AppleSignInCancelledError(), t, "apple"),
    "auth.appleSignInCancelled",
  );
  assert.equal(
    resolveOAuthErrorMessage(new FacebookSignInCancelledError(), t, "facebook"),
    "auth.facebookSignInCancelled",
  );

  for (const provider of ["google", "apple", "facebook"] as const) {
    const code = provider === "google" ? "GOOGLE_ACCOUNT_NOT_REGISTERED" : "OAUTH_ACCOUNT_NOT_REGISTERED";
    const msg = resolveOAuthErrorMessage(
      normalized(code, "OAuthAccountNotFound"),
      t,
      provider,
    );
    assert.equal(msg, "auth.oauthAccountNotRegistered");
    assert.doesNotMatch(msg, /OAuthAccountNotFound/i);
    assert.doesNotMatch(msg, /OAUTH_ACCOUNT_NOT_REGISTERED/);
    assert.doesNotMatch(msg, /GOOGLE_ACCOUNT_NOT_REGISTERED/);
  }

  const linking = resolveOAuthErrorMessage(
    normalized("OAUTH_LINKING_REQUIRED", "OAUTH_LINKING_REQUIRED", 409),
    t,
    "google",
  );
  assert.equal(linking, "auth.oauthLinkingRequired");
  assert.doesNotMatch(linking, /OAUTH_LINKING_REQUIRED/);

  const failed = resolveOAuthErrorMessage(new Error("prisma unique constraint"), t, "google");
  assert.equal(failed, "auth.googleSignInFailed");
  assert.doesNotMatch(failed, /prisma/i);

  assert.equal(
    isOAuthAccountNotRegistered(normalized("OAUTH_ACCOUNT_NOT_REGISTERED", "nope")),
    true,
  );
  assert.equal(isOAuthAccountNotRegistered(normalized("OAUTH_LINKING_REQUIRED", "nope")), false);
}

function main(): void {
  runPolicy();
  runSourceConsistency();
  runErrorMapping();
  console.log("social-auth-consistency-runtime: OK");
}

main();
