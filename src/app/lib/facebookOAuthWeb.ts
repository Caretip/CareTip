import { facebookOAuthWebAppId } from "./oauthProviderIds";
import {
  beginFacebookOAuthDiagnostic,
  clearFacebookOAuthDiagnostic,
  logFacebookOAuthDiagnostic,
} from "./facebookOAuthDiagnostic";

type FbAuthResponse = {
  accessToken?: string;
  userID?: string;
  expiresIn?: number;
  signedRequest?: string;
  graphDomain?: string;
  data_access_expiration_time?: number;
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
const FB_LOGIN_CALLBACK_WATCHDOG_MS = 120_000;

let fbSdkPromise: Promise<FbSdk> | null = null;
let sdkLoadInvocationCount = 0;
let sdkInitInvocationCount = 0;
let fbLoginInvocationCount = 0;
let fbInitCompletedForAppId: string | null = null;
let activeFbLoginCorrelationId: string | null = null;

export type FbLoginOutcome =
  | "connected_with_token"
  | "connected_without_token"
  | "not_authorized"
  | "unknown"
  | "other_status";

function safeAuthResponseFieldNames(authResponse: FbAuthResponse | null | undefined): string[] {
  if (!authResponse || typeof authResponse !== "object") return [];
  return Object.keys(authResponse).filter((key) => key !== "accessToken" && key !== "signedRequest");
}

function classifyFbLoginOutcome(status: string, hasAccessToken: boolean): FbLoginOutcome {
  if (status === "connected" && hasAccessToken) return "connected_with_token";
  if (status === "connected" && !hasAccessToken) return "connected_without_token";
  if (status === "not_authorized") return "not_authorized";
  if (status === "unknown") return "unknown";
  return "other_status";
}

function safeLoginResponseDiagnostics(response: FbLoginStatus) {
  const hasAccessToken = Boolean(response.authResponse?.accessToken?.trim());
  const userId = response.authResponse?.userID?.trim() || null;
  return {
    status: response.status,
    hasAuthResponse: response.authResponse != null,
    hasAccessToken,
    hasUserId: Boolean(userId),
    ...(userId ? { facebookUserId: userId } : {}),
    authResponseFieldNames: safeAuthResponseFieldNames(response.authResponse),
    outcome: classifyFbLoginOutcome(response.status, hasAccessToken),
  };
}

function runFbInit(
  appId: string,
  source: string,
  correlationId?: string,
): void {
  sdkInitInvocationCount += 1;
  const duplicateInit = fbInitCompletedForAppId === appId;
  logFacebookOAuthDiagnostic("sdk_init", {
    correlationId,
    source,
    sdkInitInvocation: sdkInitInvocationCount,
    duplicateInit,
    scriptTagPresent: Boolean(document.querySelector(`script[src="${FB_SDK_SRC}"]`)),
    windowFbPresent: Boolean(window.FB),
  });
  window.FB!.init({
    appId,
    cookie: true,
    xfbml: false,
    version: "v21.0",
  });
  fbInitCompletedForAppId = appId;
  logFacebookOAuthDiagnostic("sdk_init_completed", {
    correlationId,
    source,
    sdkInitInvocation: sdkInitInvocationCount,
    duplicateInit,
  });
}

function loadFacebookSdk(appId: string, correlationId?: string): Promise<FbSdk> {
  if (typeof window === "undefined") {
    logFacebookOAuthDiagnostic("sdk_unavailable", {
      correlationId,
      reason: "not_browser",
    });
    return Promise.reject(new Error("Facebook Login is only available in the browser."));
  }

  sdkLoadInvocationCount += 1;
  const loadInvocation = sdkLoadInvocationCount;

  if (window.FB) {
    logFacebookOAuthDiagnostic("sdk_loaded", {
      correlationId,
      loadInvocation,
      path: "window_fb_already_present",
      reusedExistingPromise: false,
      skippedInit: true,
      sdkInitInvocation: sdkInitInvocationCount,
    });
    return Promise.resolve(window.FB);
  }

  if (fbSdkPromise) {
    logFacebookOAuthDiagnostic("sdk_load_wait", {
      correlationId,
      loadInvocation,
      path: "reuse_inflight_promise",
    });
    return fbSdkPromise;
  }

  logFacebookOAuthDiagnostic("sdk_load_started", {
    correlationId,
    loadInvocation,
    path: "new_promise",
    scriptTagPresent: Boolean(document.querySelector(`script[src="${FB_SDK_SRC}"]`)),
  });

  fbSdkPromise = new Promise<FbSdk>((resolve, reject) => {
    const prevInit = window.fbAsyncInit;
    let fbAsyncInitFired = false;

    window.fbAsyncInit = () => {
      fbAsyncInitFired = true;
      logFacebookOAuthDiagnostic("sdk_fb_async_init", {
        correlationId,
        loadInvocation,
      });
      try {
        prevInit?.();
      } catch (e) {
        logFacebookOAuthDiagnostic("sdk_fb_async_init_prev_error", {
          correlationId,
          errorClass: e instanceof Error ? e.name : "Error",
        });
      }
      try {
        if (!window.FB) {
          logFacebookOAuthDiagnostic("sdk_init_failed", {
            correlationId,
            source: "fbAsyncInit",
            reason: "window_fb_missing_after_async_init",
          });
          reject(new Error("Facebook SDK init failed."));
          return;
        }
        runFbInit(appId, "fbAsyncInit", correlationId);
        resolve(window.FB);
      } catch (e) {
        logFacebookOAuthDiagnostic("sdk_init_failed", {
          correlationId,
          source: "fbAsyncInit",
          errorClass: e instanceof Error ? e.name : "Error",
        });
        reject(e instanceof Error ? e : new Error("Facebook SDK init failed."));
      }
    };

    if (document.querySelector(`script[src="${FB_SDK_SRC}"]`)) {
      logFacebookOAuthDiagnostic("sdk_script_tag_existing", {
        correlationId,
        loadInvocation,
        path: "poll_for_window_fb",
      });

      const initReadyFb = (via: "poll" | "immediate") => {
        if (!window.FB) {
          logFacebookOAuthDiagnostic("sdk_init_failed", {
            correlationId,
            source: via,
            reason: "window_fb_missing",
          });
          reject(new Error("Facebook SDK init failed."));
          return;
        }
        runFbInit(appId, `script_tag_${via}`, correlationId);
        logFacebookOAuthDiagnostic("sdk_loaded", {
          correlationId,
          loadInvocation,
          path: `script_tag_${via}`,
          fbAsyncInitFired,
        });
        resolve(window.FB);
      };

      if (window.FB) {
        initReadyFb("immediate");
        return;
      }

      let attempts = 0;
      const maxAttempts = 150;
      const poll = () => {
        if (window.FB) {
          initReadyFb("poll");
          return;
        }
        attempts += 1;
        if (attempts === 1 || attempts % 25 === 0) {
          logFacebookOAuthDiagnostic("sdk_poll_tick", {
            correlationId,
            loadInvocation,
            attempt: attempts,
            maxAttempts,
            fbAsyncInitFired,
          });
        }
        if (attempts >= maxAttempts) {
          fbSdkPromise = null;
          logFacebookOAuthDiagnostic("sdk_load_failed", {
            correlationId,
            loadInvocation,
            reason: "poll_timeout_15s",
            fbAsyncInitFired,
            case: "A",
          });
          reject(new Error("Facebook SDK did not become ready."));
          return;
        }
        window.setTimeout(poll, 100);
      };
      poll();
      return;
    }

    const script = document.createElement("script");
    script.src = FB_SDK_SRC;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      fbSdkPromise = null;
      logFacebookOAuthDiagnostic("sdk_load_failed", {
        correlationId,
        loadInvocation,
        reason: "script_onerror",
      });
      reject(new Error("Could not load Facebook Login."));
    };
    script.onload = () => {
      logFacebookOAuthDiagnostic("sdk_script_onload", {
        correlationId,
        loadInvocation,
        windowFbPresent: Boolean(window.FB),
        fbAsyncInitFired,
      });
    };
    document.head.appendChild(script);
    logFacebookOAuthDiagnostic("sdk_script_appended", {
      correlationId,
      loadInvocation,
    });
  }).catch((err) => {
    fbSdkPromise = null;
    throw err;
  });

  return fbSdkPromise;
}

/** Best-effort Facebook user access token (sent to CareTip as idToken). */
export async function requestFacebookAccessToken(): Promise<string> {
  const correlationId = beginFacebookOAuthDiagnostic();
  logFacebookOAuthDiagnostic("requestFacebookAccessToken_started", { correlationId });

  const appId = facebookOAuthWebAppId();
  if (!appId) {
    logFacebookOAuthDiagnostic("requestFacebookAccessToken_rejected", {
      correlationId,
      reason: "app_id_not_configured",
    });
    clearFacebookOAuthDiagnostic();
    throw new Error("Facebook Login is not configured (VITE_FACEBOOK_APP_ID).");
  }

  let FB: FbSdk;
  try {
    FB = await loadFacebookSdk(appId, correlationId);
  } catch (e) {
    logFacebookOAuthDiagnostic("requestFacebookAccessToken_rejected", {
      correlationId,
      reason: "sdk_load_or_init_failed",
      errorClass: e instanceof Error ? e.name : "Error",
      apiOAuthWillBeCalled: false,
    });
    clearFacebookOAuthDiagnostic();
    throw e;
  }

  if (!FB?.login) {
    logFacebookOAuthDiagnostic("requestFacebookAccessToken_rejected", {
      correlationId,
      reason: "fb_login_unavailable",
      apiOAuthWillBeCalled: false,
    });
    clearFacebookOAuthDiagnostic();
    throw new Error("Facebook Login is not available.");
  }

  fbLoginInvocationCount += 1;
  const loginInvocation = fbLoginInvocationCount;
  const previousLoginCorrelationId = activeFbLoginCorrelationId;
  const concurrentLogin = previousLoginCorrelationId != null && previousLoginCorrelationId !== correlationId;
  activeFbLoginCorrelationId = correlationId;

  logFacebookOAuthDiagnostic("sdk_login_started", {
    correlationId,
    loginInvocation,
    concurrentLogin,
    ...(previousLoginCorrelationId ? { previousLoginCorrelationId } : {}),
  });

  return new Promise<string>((resolve, reject) => {
    let callbackReceived = false;
    const watchdog = window.setTimeout(() => {
      if (!callbackReceived) {
        logFacebookOAuthDiagnostic("sdk_login_callback_never_fired", {
          correlationId,
          loginInvocation,
          elapsedMs: FB_LOGIN_CALLBACK_WATCHDOG_MS,
          case: "A",
          apiOAuthWillBeCalled: false,
        });
      }
    }, FB_LOGIN_CALLBACK_WATCHDOG_MS);

    const finish = (outcome: "resolved" | "rejected", extra: Record<string, unknown>) => {
      window.clearTimeout(watchdog);
      if (activeFbLoginCorrelationId === correlationId) {
        activeFbLoginCorrelationId = null;
      }
      logFacebookOAuthDiagnostic(`requestFacebookAccessToken_${outcome}`, {
        correlationId,
        loginInvocation,
        apiOAuthWillBeCalled: outcome === "resolved",
        ...extra,
      });
    };

    try {
      FB.login(
        (response) => {
          callbackReceived = true;
          const diagnostics = safeLoginResponseDiagnostics(response);
          logFacebookOAuthDiagnostic("sdk_login_callback_received", {
            correlationId,
            loginInvocation,
            ...diagnostics,
          });

          const token = response.authResponse?.accessToken?.trim();
          if (diagnostics.outcome === "connected_with_token" && token) {
            logFacebookOAuthDiagnostic("sdk_login_token_ready", {
              correlationId,
              loginInvocation,
              status: response.status,
              hasAccessToken: true,
              ...(diagnostics.facebookUserId ? { facebookUserId: diagnostics.facebookUserId } : {}),
            });
            finish("resolved", { outcome: diagnostics.outcome });
            resolve(token);
            return;
          }

          logFacebookOAuthDiagnostic("sdk_login_no_token", {
            correlationId,
            loginInvocation,
            case: "A",
            ...diagnostics,
            apiOAuthWillBeCalled: false,
          });
          finish("rejected", { outcome: diagnostics.outcome, reason: "no_token_from_sdk" });
          clearFacebookOAuthDiagnostic();
          reject(new Error("Facebook Login was cancelled or did not return a token."));
        },
        { scope: "email,public_profile", return_scopes: true },
      );
      logFacebookOAuthDiagnostic("sdk_login_invoke", {
        correlationId,
        loginInvocation,
      });
    } catch (e) {
      callbackReceived = true;
      window.clearTimeout(watchdog);
      logFacebookOAuthDiagnostic("sdk_login_threw", {
        correlationId,
        loginInvocation,
        errorClass: e instanceof Error ? e.name : "Error",
        apiOAuthWillBeCalled: false,
        case: "A",
      });
      finish("rejected", { reason: "fb_login_exception" });
      clearFacebookOAuthDiagnostic();
      reject(e instanceof Error ? e : new Error("Facebook Login failed."));
    }
  });
}
