import { Platform } from "react-native";
import {
  AppleSignInCancelledError,
  AppleSignInUnavailableError,
} from "@/services/apple/appleSignInErrors";

export {
  AppleSignInCancelledError,
  AppleSignInUnavailableError,
} from "@/services/apple/appleSignInErrors";

type AppleAuthModule = typeof import("expo-apple-authentication");

/** Lazy load — avoids crashing JS init when native module is missing (Expo Go / web). */
function loadAppleAuthModule(): AppleAuthModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-apple-authentication") as AppleAuthModule;
  } catch {
    return null;
  }
}

export function isAppleSignInNativeAvailable(): boolean {
  if (Platform.OS !== "ios") return false;
  return loadAppleAuthModule() != null;
}

/**
 * True when Sign in with Apple is offered on this device.
 * Soft-fails when the package or capability is missing.
 */
export async function isAppleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== "ios") return false;
  const mod = loadAppleAuthModule();
  if (!mod) return false;
  try {
    return await mod.isAvailableAsync();
  } catch {
    return false;
  }
}

export function isAppleSignInConfigured(): boolean {
  return Platform.OS === "ios" && isAppleSignInNativeAvailable();
}

export type AppleSignInResult = {
  idToken: string;
  fullName?: string;
};

/**
 * Native Apple authorize → identity token for POST /api/auth/oauth.
 * Does NOT call the CareTip backend.
 */
export async function requestAppleIdToken(): Promise<AppleSignInResult> {
  if (Platform.OS !== "ios") {
    throw new AppleSignInUnavailableError("Sign in with Apple is only available on iOS.");
  }

  const mod = loadAppleAuthModule();
  if (!mod) {
    throw new AppleSignInUnavailableError(
      "Apple Sign-In native module is unavailable. Rebuild the iOS client after installing expo-apple-authentication.",
    );
  }

  const available = await mod.isAvailableAsync();
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

    if (!credential.identityToken) {
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

export function mapAppleNativeError(error: unknown): Error {
  if (error instanceof AppleSignInCancelledError) return error;
  if (error instanceof AppleSignInUnavailableError) return error;

  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ERR_REQUEST_CANCELED"
  ) {
    return new AppleSignInCancelledError();
  }

  return error instanceof Error ? error : new Error("Apple sign-in failed.");
}
