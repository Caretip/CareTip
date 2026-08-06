import { appleOAuthWebClientId } from "./oauthProviderIds";

type AppleAuthSuccess = {
  authorization?: { id_token?: string; code?: string };
};

type AppleIDAuth = {
  init: (config: {
    clientId: string;
    scope: string;
    redirectURI: string;
    usePopup: boolean;
  }) => void;
  signIn: () => Promise<AppleAuthSuccess>;
};

declare global {
  interface Window {
    AppleID?: { auth: AppleIDAuth };
  }
}

const APPLE_SDK_SRC =
  "https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js";

let appleSdkPromise: Promise<AppleIDAuth> | null = null;

function loadAppleSdk(): Promise<AppleIDAuth> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Apple Sign In is only available in the browser."));
  }
  if (window.AppleID?.auth) {
    return Promise.resolve(window.AppleID.auth);
  }
  if (appleSdkPromise) return appleSdkPromise;

  appleSdkPromise = new Promise<AppleIDAuth>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${APPLE_SDK_SRC}"]`);
    const onReady = () => {
      const auth = window.AppleID?.auth;
      if (auth) resolve(auth);
      else reject(new Error("Apple Sign In SDK failed to initialize."));
    };
    if (existing) {
      if (window.AppleID?.auth) onReady();
      else existing.addEventListener("load", onReady, { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Could not load Apple Sign In.")),
        { once: true },
      );
      return;
    }
    const script = document.createElement("script");
    script.src = APPLE_SDK_SRC;
    script.async = true;
    script.onload = onReady;
    script.onerror = () => reject(new Error("Could not load Apple Sign In."));
    document.head.appendChild(script);
  }).catch((err) => {
    appleSdkPromise = null;
    throw err;
  });

  return appleSdkPromise;
}

/** Best-effort Apple ID token via Apple JS SDK (popup). */
export async function requestAppleIdToken(): Promise<string> {
  const clientId = appleOAuthWebClientId();
  if (!clientId) {
    throw new Error("Apple Sign In is not configured (VITE_APPLE_CLIENT_ID).");
  }

  const auth = await loadAppleSdk();
  auth.init({
    clientId,
    scope: "name email",
    redirectURI: window.location.origin,
    usePopup: true,
  });

  const result = await auth.signIn();
  const idToken = result.authorization?.id_token?.trim();
  if (!idToken) {
    throw new Error("Apple Sign In did not return an identity token.");
  }
  return idToken;
}

export async function isAppleSdkAvailable(): Promise<boolean> {
  if (!appleOAuthWebClientId()) return false;
  try {
    await loadAppleSdk();
    return Boolean(window.AppleID?.auth);
  } catch {
    return false;
  }
}
