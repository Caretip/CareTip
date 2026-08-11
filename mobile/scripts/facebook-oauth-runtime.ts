/**
 * Facebook mobile OAuth integration regression.
 *
 *   npm run test:facebook-oauth
 *   npx tsx scripts/facebook-oauth-runtime.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FACEBOOK_OAUTH_PROVIDER,
  FACEBOOK_UNAVAILABLE_I18N_KEY,
  isFacebookMobileReady,
} from "../utils/facebookAuthPolicy";
import { socialProvidersForPlatform } from "../utils/socialAuthUiPolicy";
import { resolveOAuthErrorMessage } from "../utils/oauthErrorMessage";
import { FacebookSignInUnavailableError } from "../services/facebook/facebookSignInErrors";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.join(__dirname, "..");

const t = (key: string) => key;

function read(rel: string): string {
  return fs.readFileSync(path.join(mobileRoot, rel), "utf8");
}

function walkSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name === "node_modules" ||
      entry.name === ".expo" ||
      entry.name === "android" ||
      entry.name === "ios"
    ) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSourceFiles(full, acc);
    } else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

function main(): void {
  assert.equal(FACEBOOK_OAUTH_PROVIDER, "facebook");
  assert.ok(socialProvidersForPlatform("ios").includes("facebook"));
  assert.ok(socialProvidersForPlatform("android").includes("facebook"));
  assert.deepEqual(socialProvidersForPlatform("ios"), socialProvidersForPlatform("ios"));

  const login = read("features/auth/LoginScreen.tsx");
  const sheet = read("components/auth/AuthRegisterSheet.tsx");
  assert.match(login, /SocialAuthButtons/);
  assert.match(login, /configuredProviders/);
  assert.match(sheet, /SocialAuthButtons/);
  assert.match(sheet, /configuredProviders|providers/);
  assert.match(login, /isLogin:\s*true/);
  assert.match(login, /isLogin:\s*false,\s*intendedRole:\s*"MANAGER"/);

  assert.equal(
    isFacebookMobileReady({ appId: undefined, nativeSdkAvailable: true }),
    false,
  );
  assert.equal(
    isFacebookMobileReady({ appId: "123", nativeSdkAvailable: false }),
    false,
  );
  assert.equal(
    isFacebookMobileReady({ appId: "123", nativeSdkAvailable: true }),
    false,
    "Client Token is required for native Facebook Login",
  );
  assert.equal(
    isFacebookMobileReady({ appId: "123", clientToken: "tok", nativeSdkAvailable: true }),
    true,
  );

  const unavailable = resolveOAuthErrorMessage(
    new FacebookSignInUnavailableError(),
    t,
    "facebook",
  );
  assert.equal(unavailable, FACEBOOK_UNAVAILABLE_I18N_KEY);
  assert.doesNotMatch(unavailable, /FACEBOOK_APP_SECRET/);
  assert.doesNotMatch(unavailable, /OAUTH_/);

  const en = read("i18n/locales/en.ts");
  assert.match(en, /Facebook sign-in is not available yet/);

  const facebookService = read("services/facebook/facebookSignIn.ts");
  assert.match(facebookService, /requestFacebookIdToken/);
  assert.match(facebookService, /react-native-fbsdk-next/);
  assert.match(facebookService, /NativeModules\.FBLoginManager/);
  assert.match(facebookService, /Never probe native Facebook during boot/);
  assert.match(facebookService, /hasPublicFacebookConfig/);
  const configuredFn = facebookService.slice(
    facebookService.indexOf("export function isFacebookSignInConfigured"),
    facebookService.indexOf("function configureFacebookSdk"),
  );
  assert.doesNotMatch(configuredFn, /require\("react-native-fbsdk-next"\)/);
  assert.doesNotMatch(facebookService, /EXPO_PUBLIC_FACEBOOK_APP_SECRET/);
  assert.doesNotMatch(facebookService, /process\.env\.FACEBOOK_APP_SECRET/);
  assert.doesNotMatch(facebookService, /mockFacebook|fakeFacebook|bypassMeta/i);

  const authService = read("services/auth/authService.ts");
  assert.match(authService, /API_ENDPOINTS\.auth\.oauth/);
  assert.match(authService, /provider,/);
  assert.match(authService, /idToken: payload\.idToken/);

  const hook = read("hooks/useSocialAuth.ts");
  assert.match(hook, /requestFacebookIdToken/);
  assert.match(hook, /provider,/);
  assert.match(hook, /signInWithOAuth/);
  assert.match(hook, /googleSignIn/);
  assert.match(hook, /appleSignIn/);

  const configSrc = read("constants/config.ts");
  assert.match(configSrc, /EXPO_PUBLIC_FACEBOOK_APP_ID/);
  assert.match(configSrc, /EXPO_PUBLIC_FACEBOOK_CLIENT_TOKEN/);
  assert.doesNotMatch(configSrc, /EXPO_PUBLIC_FACEBOOK_APP_SECRET/);
  assert.doesNotMatch(configSrc, /process\.env\.FACEBOOK_APP_SECRET/);

  for (const file of walkSourceFiles(path.join(mobileRoot, "constants"))) {
    const src = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(src, /EXPO_PUBLIC_FACEBOOK_APP_SECRET/);
  }
  for (const file of walkSourceFiles(path.join(mobileRoot, "services"))) {
    const src = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(src, /process\.env\.FACEBOOK_APP_SECRET/);
    assert.doesNotMatch(src, /process\.env\.META_APP_SECRET/);
  }

  const appConfig = read("app.config.js");
  assert.match(appConfig, /react-native-fbsdk-next/);
  assert.match(appConfig, /EXPO_PUBLIC_FACEBOOK_APP_ID/);
  assert.match(appConfig, /EXPO_PUBLIC_FACEBOOK_CLIENT_TOKEN/);
  assert.match(appConfig, /facebookAppId && facebookClientToken/);
  assert.match(appConfig, /isAutoInitEnabled:\s*false/);
  assert.doesNotMatch(appConfig, /FACEBOOK_APP_SECRET/);

  const rnConfig = read("react-native.config.js");
  assert.match(rnConfig, /react-native-fbsdk-next/);
  assert.match(rnConfig, /android:\s*null/);
  assert.match(rnConfig, /ios:\s*null/);
  assert.match(rnConfig, /EXPO_PUBLIC_FACEBOOK_APP_ID/);
  assert.doesNotMatch(rnConfig, /FACEBOOK_APP_SECRET/);

  const pkg = JSON.parse(read("package.json")) as { dependencies?: Record<string, string> };
  assert.ok(pkg.dependencies?.["react-native-fbsdk-next"]);

  const oauthAuth = fs.readFileSync(
    path.join(mobileRoot, "..", "backend", "src", "services", "oauthAuth.service.ts"),
    "utf8",
  );
  assert.match(oauthAuth, /never auto-link by email/);
  assert.match(oauthAuth, /OAUTH_LINKING_REQUIRED/);

  const googleService = read("services/google/googleSignIn.ts");
  const appleService = read("services/apple/appleSignIn.ts");
  assert.match(googleService, /requestGoogleIdToken/);
  assert.match(appleService, /requestAppleIdToken/);

  console.log("facebook-oauth-runtime: OK");
}

main();
