import { facebookOAuthWebAppId } from "./oauthProviderIds";

type FbAuthResponse = {
  accessToken?: string;
  userID?: string;
};

type FbLoginStatus = {
  status: string;
  authResponse?: FbAuthResponse | null;
};

type FbSdk = {
  init: (config: {
    appId: string;
    cookie?: boolean;
    xfbml?: boolean;
    version: string;
  }) => void;
  login: (
    callback: (response: FbLoginStatus) => void,
    options?: { scope?: string; return_scopes?: boolean },
  ) => void;
  getLoginStatus: (callback: (response: FbLoginStatus) => void) => void;
};

declare global {
  interface Window {
    FB?: FbSdk;
    fbAsyncInit?: () => void;
  }
}

const FB_SDK_SRC = "https://connect.facebook.net/en_US/sdk.js";
let fbSdkPromise: Promise<FbSdk> | null = null;

function loadFacebookSdk(appId: string): Promise<FbSdk> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Facebook Login is only available in the browser."));
  }
  if (window.FB) {
    return Promise.resolve(window.FB);
  }
  if (fbSdkPromise) return fbSdkPromise;

  fbSdkPromise = new Promise<FbSdk>((resolve, reject) => {
    const prevInit = window.fbAsyncInit;
    window.fbAsyncInit = () => {
      try {
        prevInit?.();
      } catch {
        /* ignore prior init errors */
      }
      try {
        window.FB!.init({
          appId,
          cookie: true,
          xfbml: false,
          version: "v21.0",
        });
        resolve(window.FB!);
      } catch (e) {
        reject(e instanceof Error ? e : new Error("Facebook SDK init failed."));
      }
    };

    if (document.querySelector(`script[src="${FB_SDK_SRC}"]`)) {
      if (window.FB) {
        window.FB.init({ appId, cookie: true, xfbml: false, version: "v21.0" });
        resolve(window.FB);
      }
      return;
    }

    const script = document.createElement("script");
    script.src = FB_SDK_SRC;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      fbSdkPromise = null;
      reject(new Error("Could not load Facebook Login."));
    };
    document.head.appendChild(script);
  }).catch((err) => {
    fbSdkPromise = null;
    throw err;
  });

  return fbSdkPromise;
}

/** Best-effort Facebook user access token (sent to CareTip as idToken). */
export async function requestFacebookAccessToken(): Promise<string> {
  const appId = facebookOAuthWebAppId();
  if (!appId) {
    throw new Error("Facebook Login is not configured (VITE_FACEBOOK_APP_ID).");
  }

  const FB = await loadFacebookSdk(appId);

  return new Promise<string>((resolve, reject) => {
    FB.login(
      (response) => {
        const token = response.authResponse?.accessToken?.trim();
        if (response.status === "connected" && token) {
          resolve(token);
          return;
        }
        reject(new Error("Facebook Login was cancelled or did not return a token."));
      },
      { scope: "email,public_profile", return_scopes: true },
    );
  });
}
