import {
  FacebookSignInCancelledError,
  FacebookSignInUnavailableError,
} from "@/services/facebook/facebookSignInErrors";

export {
  FacebookSignInCancelledError,
  FacebookSignInUnavailableError,
} from "@/services/facebook/facebookSignInErrors";

/**
 * Facebook Login via react-native-fbsdk-next.
 *
 * Soft-fail stub until the SDK is installed and configured in EAS:
 * - Add `react-native-fbsdk-next` + Expo config plugin
 * - Set Facebook App ID / Client Token in app.config / Info.plist / AndroidManifest
 * - Rebuild a custom/dev client (not available in Expo Go)
 *
 * When the native module is present, this will request a limited-login /
 * identity token (or access token) for POST /api/auth/oauth { provider: "facebook" }.
 */

type FacebookSdkModule = {
  LoginManager: {
    logInWithPermissions: (permissions: string[]) => Promise<{ isCancelled?: boolean }>;
    logOut: () => void;
  };
  AccessToken: {
    getCurrentAccessToken: () => Promise<{ accessToken: string } | null>;
  };
  /** Optional Limited Login JWT when configured. */
  AuthenticationToken?: {
    getAuthenticationTokenIOS: () => Promise<{ authenticationToken: string } | null>;
  };
};

/** Lazy load — soft-fail when SDK is not installed. */
function loadFacebookSdk(): FacebookSdkModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("react-native-fbsdk-next") as FacebookSdkModule;
  } catch {
    return null;
  }
}

export function isFacebookSignInNativeAvailable(): boolean {
  return loadFacebookSdk() != null;
}

/** Facebook is only considered configured once the native SDK is present in the build. */
export function isFacebookSignInConfigured(): boolean {
  return isFacebookSignInNativeAvailable();
}

/**
 * Request a Facebook identity/access token for CareTip OAuth.
 * Throws unavailable until react-native-fbsdk-next is installed + EAS-configured.
 */
export async function requestFacebookIdToken(): Promise<string> {
  const mod = loadFacebookSdk();
  if (!mod) {
    throw new FacebookSignInUnavailableError(
      "Facebook Sign-In is not configured. Install react-native-fbsdk-next and configure the Facebook App ID in EAS, then rebuild.",
    );
  }

  try {
    const result = await mod.LoginManager.logInWithPermissions(["public_profile", "email"]);
    if (result.isCancelled) {
      throw new FacebookSignInCancelledError();
    }

    // Prefer Limited Login JWT on iOS when available (backend verifies as idToken).
    if (mod.AuthenticationToken?.getAuthenticationTokenIOS) {
      const auth = await mod.AuthenticationToken.getAuthenticationTokenIOS();
      if (auth?.authenticationToken) {
        return auth.authenticationToken;
      }
    }

    const access = await mod.AccessToken.getCurrentAccessToken();
    if (!access?.accessToken) {
      throw new FacebookSignInUnavailableError("Facebook did not return an access token.");
    }
    return access.accessToken;
  } catch (error) {
    throw mapFacebookNativeError(error);
  }
}

export function mapFacebookNativeError(error: unknown): Error {
  if (error instanceof FacebookSignInCancelledError) return error;
  if (error instanceof FacebookSignInUnavailableError) return error;
  return error instanceof Error ? error : new Error("Facebook sign-in failed.");
}
