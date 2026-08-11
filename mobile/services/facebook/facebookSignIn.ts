import { NativeModules, Platform } from "react-native";
import { config } from "@/constants/config";
import { isFacebookMobileReady } from "@/utils/facebookAuthPolicy";
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
 * Public config only: EXPO_PUBLIC_FACEBOOK_APP_ID + EXPO_PUBLIC_FACEBOOK_CLIENT_TOKEN.
 * FACEBOOK_APP_SECRET stays on the API (Graph access-token debug_token).
 *
 * Requires a custom/dev client rebuild after installing the SDK + Expo plugin.
 * Expo Go does not include the native module.
 */

type FacebookLoginResult = {
  isCancelled?: boolean;
};

type FacebookSdkModule = {
  Settings?: {
    setAppID?: (appId: string) => void;
    setClientToken?: (token: string) => void;
    initializeSDK?: () => void;
  };
  LoginManager: {
    logInWithPermissions: (
      permissions: string[],
      loginTracking?: "limited" | "enabled",
    ) => Promise<FacebookLoginResult>;
    logOut: () => void;
  };
  AccessToken: {
    getCurrentAccessToken: () => Promise<{ accessToken: string } | null>;
  };
  AuthenticationToken?: {
    getAuthenticationTokenIOS: () => Promise<{ authenticationToken: string } | null>;
  };
};

let configured = false;

/** Lazy load — soft-fail when SDK is not in this native binary (Expo Go / pre-rebuild). */
function loadFacebookSdk(): FacebookSdkModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("react-native-fbsdk-next") as FacebookSdkModule;
  } catch {
    return null;
  }
}

export function isFacebookSignInNativeAvailable(): boolean {
  if (!NativeModules.FBLoginManager) return false;
  return loadFacebookSdk() != null;
}

export function isFacebookSignInConfigured(): boolean {
  return isFacebookMobileReady({
    appId: config.facebookAppId,
    clientToken: config.facebookClientToken,
    nativeSdkAvailable: isFacebookSignInNativeAvailable(),
  });
}

function configureFacebookSdk(mod: FacebookSdkModule): void {
  if (configured) return;
  const appId = config.facebookAppId;
  if (!appId) return;
  mod.Settings?.setAppID?.(appId);
  if (config.facebookClientToken) {
    mod.Settings?.setClientToken?.(config.facebookClientToken);
  }
  mod.Settings?.initializeSDK?.();
  configured = true;
}

/**
 * Native Facebook account picker → Limited Login JWT or Graph access token
 * for POST /api/auth/oauth { provider: "facebook" }.
 */
export async function requestFacebookIdToken(): Promise<string> {
  if (!config.facebookAppId || !config.facebookClientToken) {
    throw new FacebookSignInUnavailableError(
      "Facebook Sign-In is not configured.",
    );
  }

  const mod = loadFacebookSdk();
  if (!mod || !NativeModules.FBLoginManager) {
    throw new FacebookSignInUnavailableError(
      "Facebook Sign-In native module is unavailable. Rebuild the dev client after installing react-native-fbsdk-next.",
    );
  }

  configureFacebookSdk(mod);

  try {
    const tracking = Platform.OS === "ios" ? "limited" : "enabled";
    const result = await mod.LoginManager.logInWithPermissions(["public_profile", "email"], tracking);
    if (result.isCancelled) {
      throw new FacebookSignInCancelledError();
    }

    if (Platform.OS === "ios" && mod.AuthenticationToken?.getAuthenticationTokenIOS) {
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

  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/cancel/i.test(message)) {
    return new FacebookSignInCancelledError();
  }

  return error instanceof Error ? error : new Error("Facebook sign-in failed.");
}
