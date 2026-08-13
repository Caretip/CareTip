import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { config } from "@/constants/config";
import {
  AppleSignInCancelledError,
  AppleSignInUnavailableError,
} from "@/services/apple/appleSignInErrors";
import {
  appleAndroidDeepLinkPrefix,
  appleAndroidRedirectUri,
  buildAppleAuthorizeUrl,
  encodeAppleAndroidState,
  isAppleServicesIdShapeValid,
  isHttpsAppleRedirectUri,
  parseAppleAuthCallbackUrl,
  resolveAppleNativeScheme,
} from "@/services/apple/appleAndroidOAuth";

export {
  AppleSignInCancelledError,
  AppleSignInUnavailableError,
} from "@/services/apple/appleSignInErrors";

type AppleAuthModule = typeof import("expo-apple-authentication");

const ANDROID_APPLE_AUTH_TIMEOUT_MS = 5 * 60 * 1000;

try {
  WebBrowser.maybeCompleteAuthSession();
} catch {
  // Missing native module must not crash app boot.
}

/** Lazy load — avoids crashing JS init when native module is missing (Expo Go / web). */
function loadAppleAuthModule(): AppleAuthModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-apple-authentication") as AppleAuthModule;
  } catch {
    return null;
  }
}

function randomNonce(): string {
  const bytes = new Uint8Array(16);
  try {
    const cryptoObj = globalThis.crypto;
    if (cryptoObj?.getRandomValues) {
      cryptoObj.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i += 1) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
    }
  } catch {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function nativeAppScheme() {
  try {
    const extraScheme = Constants.expoConfig?.scheme;
    return resolveAppleNativeScheme(extraScheme);
  } catch {
    return resolveAppleNativeScheme("caretip");
  }
}

/** Dev/debug only. Never logs tokens, client IDs, or secrets. */
export function logAppleOAuthDiag(event: string): void {
  if (!__DEV__ && config.appEnv === "production") return;
  console.log(`[CareTip][AppleOAuth] ${event}`);
}

export function isAppleSignInNativeAvailable(): boolean {
  try {
    if (Platform.OS !== "ios") return false;
    return loadAppleAuthModule() != null;
  } catch {
    return false;
  }
}

export function isAppleAndroidWebConfigured(): boolean {
  try {
    if (Platform.OS !== "android") return false;
    if (!isAppleServicesIdShapeValid(config.appleClientId)) return false;
    return isHttpsAppleRedirectUri(appleAndroidRedirectUri(config.apiUrl));
  } catch {
    return false;
  }
}

/**
 * True when Sign in with Apple is offered on this device.
 * iOS: native capability. Android: public Services ID + HTTPS API bounce.
 * Never throws.
 */
export async function isAppleSignInAvailable(): Promise<boolean> {
  try {
    if (Platform.OS === "android") {
      return isAppleAndroidWebConfigured();
    }
    if (Platform.OS !== "ios") return false;
    const mod = loadAppleAuthModule();
    if (!mod) return false;
    return await mod.isAvailableAsync();
  } catch {
    return false;
  }
}

export function isAppleSignInConfigured(): boolean {
  try {
    if (Platform.OS === "android") return isAppleAndroidWebConfigured();
    return Platform.OS === "ios" && isAppleSignInNativeAvailable();
  } catch {
    return false;
  }
}

export type AppleSignInResult = {
  idToken: string;
  fullName?: string;
};

let androidAuthInFlight = false;

function dismissAppleAuthSession(): void {
  try {
    const dismiss = (WebBrowser as { dismissAuthSession?: () => void }).dismissAuthSession;
    if (typeof dismiss === "function") dismiss();
  } catch {
    // ignore
  }
}

async function requestAppleIdTokenAndroid(): Promise<AppleSignInResult> {
  if (androidAuthInFlight) {
    throw new AppleSignInUnavailableError("Apple sign-in is already in progress.");
  }

  const clientId = config.appleClientId;
  if (!isAppleServicesIdShapeValid(clientId)) {
    logAppleOAuthDiag("configuration missing");
    throw new AppleSignInUnavailableError("Apple Sign-In is not configured.");
  }

  const redirectUri = appleAndroidRedirectUri(config.apiUrl);
  if (!isHttpsAppleRedirectUri(redirectUri)) {
    logAppleOAuthDiag("configuration missing");
    throw new AppleSignInUnavailableError("Apple Sign-In is not configured.");
  }

  const scheme = nativeAppScheme();
  const nonce = randomNonce();
  const state = encodeAppleAndroidState(scheme, nonce);
  const authorizeUrl = buildAppleAuthorizeUrl({
    clientId,
    redirectUri,
    state,
    nonce,
  });

  let returnUrl = appleAndroidDeepLinkPrefix(scheme);
  try {
    const created = Linking.createURL("apple-auth");
    if (typeof created === "string" && created.trim()) returnUrl = created;
  } catch {
    // keep scheme fallback
  }

  androidAuthInFlight = true;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    if (Platform.OS === "android") {
      await WebBrowser.warmUpAsync().catch(() => undefined);
    }

    const sessionPromise = WebBrowser.openAuthSessionAsync(authorizeUrl, returnUrl);
    void sessionPromise.catch(() => undefined);

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        dismissAppleAuthSession();
        reject(new AppleSignInUnavailableError("Apple sign-in timed out."));
      }, ANDROID_APPLE_AUTH_TIMEOUT_MS);
    });

    const result = await Promise.race([sessionPromise, timeoutPromise]);

    if (result.type === "cancel" || result.type === "dismiss") {
      throw new AppleSignInCancelledError();
    }
    if (result.type !== "success" || !("url" in result) || typeof result.url !== "string" || !result.url) {
      throw new AppleSignInUnavailableError("Apple sign-in did not complete.");
    }

    return parseAppleAuthCallbackUrl(result.url);
  } catch (error) {
    throw mapAppleNativeError(error);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (Platform.OS === "android") {
      await WebBrowser.coolDownAsync().catch(() => undefined);
    }
    androidAuthInFlight = false;
  }
}

async function requestAppleIdTokenIos(): Promise<AppleSignInResult> {
  const mod = loadAppleAuthModule();
  if (!mod) {
    throw new AppleSignInUnavailableError(
      "Apple Sign-In native module is unavailable. Rebuild the iOS client after installing expo-apple-authentication.",
    );
  }

  let available = false;
  try {
    available = await mod.isAvailableAsync();
  } catch {
    available = false;
  }
  if (!available) {
    throw new AppleSignInUnavailableError("Sign in with Apple is not available on this device.");
  }

  try {
    const credential = await mod.signInAsync({
      requestedScopes: [
        mod.AppleAuthenticationScope.FULL_NAME,
        mod.AppleAuthenticationScope.EMAIL,
      ],
    });

    if (!credential?.identityToken || typeof credential.identityToken !== "string") {
      throw new AppleSignInUnavailableError("Apple did not return an identity token.");
    }

    const parts = [credential.fullName?.givenName, credential.fullName?.familyName].filter(
      (part): part is string => Boolean(part?.trim()),
    );
    const fullName = parts.length > 0 ? parts.join(" ") : undefined;

    return { idToken: credential.identityToken, fullName };
  } catch (error) {
    throw mapAppleNativeError(error);
  }
}

/**
 * iOS: native Apple authorize → identity token for POST /api/auth/oauth.
 * Android: web Apple OAuth → HTTPS bounce → deep link → same POST /api/auth/oauth.
 * Does NOT call the CareTip backend session endpoint itself.
 * Throws only AppleSignInCancelledError / AppleSignInUnavailableError / Error — never crashes the JS root.
 */
export async function requestAppleIdToken(): Promise<AppleSignInResult> {
  try {
    if (Platform.OS === "android") {
      return await requestAppleIdTokenAndroid();
    }
    if (Platform.OS !== "ios") {
      throw new AppleSignInUnavailableError("Sign in with Apple is only available on iOS and Android.");
    }
    return await requestAppleIdTokenIos();
  } catch (error) {
    throw mapAppleNativeError(error);
  }
}

export function mapAppleNativeError(error: unknown): Error {
  if (error instanceof AppleSignInCancelledError) return error;
  if (error instanceof AppleSignInUnavailableError) return error;

  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ((error as { code?: string }).code === "ERR_REQUEST_CANCELED" ||
      (error as { code?: string }).code === "ERR_CANCELED" ||
      (error as { code?: string }).code === "ERR_WEB_BROWSER_USER_CANCELED")
  ) {
    return new AppleSignInCancelledError();
  }

  return error instanceof Error ? error : new AppleSignInUnavailableError("Apple sign-in failed.");
}
