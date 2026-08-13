/**
 * Android Apple web OAuth helpers + source guards (no live Apple).
 *
 *   npm run test:apple-android
 *   npx tsx scripts/apple-android-oauth-runtime.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AppleSignInCancelledError, AppleSignInUnavailableError } from "../services/apple/appleSignInErrors";
import {
  appleAndroidRedirectUri,
  buildAppleAuthorizeUrl,
  encodeAppleAndroidState,
  isAppleAndroidCallbackUrl,
  isAppleServicesIdShapeValid,
  isHttpsAppleRedirectUri,
  parseAppleAuthCallbackUrl,
  resolveAppleNativeScheme,
} from "../services/apple/appleAndroidOAuth";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.join(__dirname, "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(mobileRoot, rel), "utf8");
}

function main(): void {
  assert.equal(resolveAppleNativeScheme("caretip"), "caretip");
  assert.equal(resolveAppleNativeScheme("caretip-dev"), "caretip-dev");
  assert.equal(resolveAppleNativeScheme("https://evil.example"), "caretip");
  assert.equal(encodeAppleAndroidState("caretip", "abc"), "caretip.abc");

  const redirect = appleAndroidRedirectUri("https://caretip.onrender.com");
  assert.equal(redirect, "https://caretip.onrender.com/api/auth/apple/native-callback");
  assert.equal(isHttpsAppleRedirectUri(redirect), true);
  assert.equal(
    isHttpsAppleRedirectUri(appleAndroidRedirectUri("http://192.168.1.10:3001")),
    false,
  );

  const authorize = buildAppleAuthorizeUrl({
    clientId: "com.example.caretip.web",
    redirectUri: redirect,
    state: "caretip.nonce",
    nonce: "nonce",
  });
  assert.ok(authorize.startsWith("https://appleid.apple.com/auth/authorize"));
  assert.match(authorize, /response_mode=form_post/);
  assert.match(authorize, /response_type=code(\+|%20)id_token/);
  assert.match(authorize, /redirect_uri=/);

  const parsed = parseAppleAuthCallbackUrl(
    "caretip://apple-auth?id_token=aaa.bbb.ccc&name=Ada%20Lovelace",
  );
  assert.equal(parsed.idToken, "aaa.bbb.ccc");
  assert.equal(parsed.fullName, "Ada Lovelace");

  assert.throws(
    () => parseAppleAuthCallbackUrl("caretip://apple-auth?error=user_cancelled_authorize"),
    AppleSignInCancelledError,
  );

  assert.equal(isAppleServicesIdShapeValid(undefined), false);
  assert.equal(isAppleServicesIdShapeValid(""), false);
  assert.equal(isAppleServicesIdShapeValid("   "), false);
  assert.equal(isAppleServicesIdShapeValid("undefined"), false);
  assert.equal(isAppleServicesIdShapeValid("https://evil.example"), false);
  assert.equal(isAppleServicesIdShapeValid("not a valid id"), false);
  assert.equal(isAppleServicesIdShapeValid("com.example.caretip.web"), true);

  assert.throws(
    () =>
      buildAppleAuthorizeUrl({
        clientId: "",
        redirectUri: redirect,
        state: "caretip.nonce",
        nonce: "nonce",
      }),
    AppleSignInUnavailableError,
  );
  assert.throws(
    () =>
      buildAppleAuthorizeUrl({
        clientId: "com.example.caretip.web",
        redirectUri: "http://localhost:3001/api/auth/apple/native-callback",
        state: "caretip.nonce",
        nonce: "nonce",
      }),
    AppleSignInUnavailableError,
  );

  assert.throws(() => parseAppleAuthCallbackUrl("caretip://apple-auth"), AppleSignInUnavailableError);
  assert.throws(() => parseAppleAuthCallbackUrl("caretip://apple-auth?id_token="), AppleSignInUnavailableError);
  assert.throws(
    () => parseAppleAuthCallbackUrl("caretip://apple-auth?id_token=invalid"),
    AppleSignInUnavailableError,
  );
  assert.throws(
    () => parseAppleAuthCallbackUrl("caretip://apple-auth?unexpected=value"),
    AppleSignInUnavailableError,
  );
  assert.throws(() => parseAppleAuthCallbackUrl(""), AppleSignInUnavailableError);
  assert.throws(
    () => parseAppleAuthCallbackUrl("caretip://apple-auth?error=invalid_request"),
    AppleSignInUnavailableError,
  );

  assert.equal(isAppleAndroidCallbackUrl("caretip://apple-auth"), true);
  assert.equal(isAppleAndroidCallbackUrl("caretip://apple-auth?id_token=aaa.bbb.ccc"), true);
  assert.equal(isAppleAndroidCallbackUrl("caretip://login"), false);
  assert.equal(isAppleAndroidCallbackUrl(null), false);

  const appleService = read("services/apple/appleSignIn.ts");
  assert.match(appleService, /Platform\.OS === "android"/);
  assert.match(appleService, /openAuthSessionAsync/);
  assert.match(appleService, /expo-apple-authentication/);
  assert.match(appleService, /requestAppleIdTokenIos/);
  assert.match(appleService, /POST \/api\/auth\/oauth/);
  assert.doesNotMatch(appleService, /isAppleSignInConfigured\(\):\s*boolean \{\s*return Platform\.OS === "ios"/);
  assert.doesNotMatch(appleService, /EXPO_PUBLIC_APPLE_PRIVATE/);
  assert.doesNotMatch(appleService, /APPLE_PRIVATE_KEY/);
  assert.doesNotMatch(appleService, /console\.(log|info|debug).*idToken/);
  assert.doesNotMatch(appleService, /console\.(log|info|debug).*id_token/);
  assert.match(appleService, /\[CareTip\]\[AppleOAuth\]/);
  assert.match(appleService, /maybeCompleteAuthSession/);
  assert.match(appleService, /ANDROID_APPLE_AUTH_TIMEOUT_MS/);
  assert.match(appleService, /androidAuthInFlight/);

  const deepLinkBridge = read("components/providers/DeepLinkBridge.tsx");
  assert.match(deepLinkBridge, /isAppleAndroidCallbackUrl/);
  const nativeIntent = read("app/+native-intent.tsx");
  assert.match(nativeIntent, /isAppleAndroidCallbackUrl/);
  assert.match(nativeIntent, /redirectSystemPath/);

  const hook = read("hooks/useSocialAuth.ts");
  assert.match(hook, /inFlightRef/);
  assert.match(hook, /requestAppleIdToken/);
  assert.match(hook, /isLogin: mode\.isLogin/);
  assert.match(hook, /mode\.isLogin && isOAuthAccountNotRegistered/);
  assert.match(hook, /finally/);
  assert.match(hook, /logAppleOAuthDiag/);

  const configSrc = read("constants/config.ts");
  assert.match(configSrc, /EXPO_PUBLIC_APPLE_CLIENT_ID/);
  assert.doesNotMatch(configSrc, /EXPO_PUBLIC_APPLE_PRIVATE/);
  assert.doesNotMatch(configSrc, /APPLE_PRIVATE_KEY/);

  const login = read("features/auth/LoginScreen.tsx");
  const register = read("features/auth/RegisterScreen.tsx");
  assert.match(login, /runSocialAuth\(provider,\s*\{\s*isLogin:\s*true/);
  assert.match(
    register,
    /runSocialAuth\(provider,\s*\{\s*isLogin:\s*false,\s*intendedRole:\s*"MANAGER"/,
  );

  const envExample = read(".env.example");
  assert.match(envExample, /EXPO_PUBLIC_APPLE_CLIENT_ID/);
  assert.doesNotMatch(envExample, /EXPO_PUBLIC_APPLE_PRIVATE/);

  console.log("apple-android-oauth-runtime: OK");
}

main();
