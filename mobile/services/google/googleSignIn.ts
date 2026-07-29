import { config } from "@/constants/config";
import {
  GoogleSignInCancelledError,
  GoogleSignInUnavailableError,
} from "@/services/google/googleSignInErrors";

export {
  GoogleSignInCancelledError,
  GoogleSignInUnavailableError,
} from "@/services/google/googleSignInErrors";

type GoogleSignInModule = typeof import("@react-native-google-signin/google-signin");

let configured = false;

/** Lazy load — avoids crashing JS init when native module is missing (Expo Go / web). */
function loadGoogleSignInModule(): GoogleSignInModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("@react-native-google-signin/google-signin") as GoogleSignInModule;
  } catch {
    return null;
  }
}

/** Idempotent — safe to call before every sign-in attempt. */
export function configureGoogleSignIn(): void {
  if (configured) return;
  if (!config.googleWebClientId) return;

  const mod = loadGoogleSignInModule();
  if (!mod) return;

  mod.GoogleSignin.configure({
    webClientId: config.googleWebClientId,
    ...(config.googleIosClientId ? { iosClientId: config.googleIosClientId } : {}),
    offlineAccess: false,
  });
  configured = true;
}

export function isGoogleSignInConfigured(): boolean {
  return Boolean(config.googleWebClientId);
}

export function isGoogleSignInNativeAvailable(): boolean {
  return loadGoogleSignInModule() != null;
}

/**
 * Native Google account picker → ID token for POST /api/auth/oauth.
 * Does NOT call the CareTip backend.
 */
export async function requestGoogleIdToken(): Promise<string> {
  if (!config.googleWebClientId) {
    throw new GoogleSignInUnavailableError(
      "Google Sign-In is not configured. Set EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID.",
    );
  }

  const mod = loadGoogleSignInModule();
  if (!mod) {
    throw new GoogleSignInUnavailableError(
      "Google Sign-In native module is unavailable. Rebuild the dev client after installing @react-native-google-signin/google-signin.",
    );
  }

  const { GoogleSignin, isCancelledResponse, isSuccessResponse } = mod;

  configureGoogleSignIn();
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

  const response = await GoogleSignin.signIn();
  if (isCancelledResponse(response)) {
    throw new GoogleSignInCancelledError();
  }
  if (!isSuccessResponse(response)) {
    throw new GoogleSignInUnavailableError("Google sign-in did not complete.");
  }

  let idToken = response.data.idToken;
  if (!idToken) {
    const tokens = await GoogleSignin.getTokens();
    idToken = tokens.idToken;
  }
  if (!idToken) {
    throw new GoogleSignInUnavailableError("Google did not return an identity token.");
  }
  return idToken;
}

export function mapGoogleNativeError(error: unknown): Error {
  if (error instanceof GoogleSignInCancelledError) return error;
  if (error instanceof GoogleSignInUnavailableError) return error;

  const mod = loadGoogleSignInModule();
  if (mod?.isErrorWithCode(error)) {
    const { statusCodes } = mod;
    if (error.code === statusCodes.SIGN_IN_CANCELLED) {
      return new GoogleSignInCancelledError();
    }
    if (error.code === statusCodes.IN_PROGRESS) {
      return new GoogleSignInUnavailableError("Google sign-in is already in progress.");
    }
    if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
      return new GoogleSignInUnavailableError("Google Play Services is unavailable.");
    }
  }

  return error instanceof Error ? error : new Error("Google sign-in failed.");
}
