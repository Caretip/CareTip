import { facebookOAuthWebAppId } from "./oauthProviderIds";
import {
  beginFacebookOAuthDiagnostic,
  clearFacebookOAuthDiagnostic,
  logFacebookOAuthDiagnostic,
  type FacebookOAuthDiagnosticCase,
} from "./facebookOAuthDiagnostic";
import { FacebookLoginError, type FacebookLoginFailureKind } from "./facebookLoginError";

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
    status?: boolean;
  }) => void;
  login: (
    callback: (response: FbLoginStatus) => void,
    options?: { scope?: string; return_scopes?: boolean },
  ) => void;
  getLoginStatus: (callback: (response: FbLoginStatus) => void, force?: boolean) => void;
};

declare global {
  interface Window {
    FB?: FbSdk;
    fbAsyncInit?: () => void;
  }
}

const FB_SDK_SRC = "https://connect.facebook.net/en_US/sdk.js";
const FB_SDK_VERSION = "v21.0";
const FB_LOGIN_CALLBACK_WATCHDOG_MS = 120_000;
const FB_GET_LOGIN_STATUS_RECOVERY_MS = 15_000;

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

/**
 * SDK outcome cases for diagnostics (A–F):
 * A popup/dialog failed to start (FB.login threw)
 * B status unknown (typically no authResponse after dialog)
 * C not_authorized
 * D connected but missing token / authResponse
 * E connected_with_token (success)
 * F FB.login callback never fired (watchdog)
 */
function sdkOutcomeCase(
  diagnostics: ReturnType<typeof safeLoginResponseDiagnostics>,
  callbackNeverFired = false,
): FacebookOAuthDiagnosticCase {
  if (callbackNeverFired) return "F";
  if (diagnostics.outcome === "connected_with_token") return "E";
  if (diagnostics.outcome === "not_authorized") return "C";
  if (diagnostics.outcome === "unknown") return "B";
  if (diagnostics.outcome === "connected_without_token") return "D";
  if (diagnostics.status === "connected" && !diagnostics.hasAuthResponse) return "D";
  return "B";
}

function loginEnvironmentSnapshot(appId: string) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return {
    pageOrigin: origin,
    pageHostname: typeof window !== "undefined" ? window.location.hostname : "",
    isSecureContext: typeof window !== "undefined" ? window.isSecureContext : false,
    navigatorCookieEnabled:
      typeof navigator !== "undefined" ? Boolean(navigator.cookieEnabled) : false,
    documentVisibilityState:
      typeof document !== "undefined" ? document.visibilityState : "unknown",
    configuredAppIdSuffix: appId.length >= 4 ? appId.slice(-4) : "set",
    sdkInitInvocationCount,
    initCompletedForConfiguredApp: fbInitCompletedForAppId === appId,
  };
}

function runFbInit(
  appId: string,
  source: string,
  correlationId?: string,
): void {
  if (fbInitCompletedForAppId === appId) {
    logFacebookOAuthDiagnostic("sdk_init_skipped", {
      correlationId,
      source,
      reason: "already_initialized_for_app_id",
      sdkInitInvocation: sdkInitInvocationCount,
    });
    return;
  }

  sdkInitInvocationCount += 1;
  logFacebookOAuthDiagnostic("sdk_init", {
    correlationId,
    source,
    sdkInitInvocation: sdkInitInvocationCount,
    duplicateInit: false,
    scriptTagPresent: Boolean(document.querySelector(`script[src="${FB_SDK_SRC}"]`)),
    windowFbPresent: Boolean(window.FB),
    sdkVersion: FB_SDK_VERSION,
    cookieEnabledInInit: true,
  });
  window.FB!.init({
    appId,
    cookie: true,
    xfbml: false,
    version: FB_SDK_VERSION,
    status: false,
  });
  fbInitCompletedForAppId = appId;
  logFacebookOAuthDiagnostic("sdk_init_completed", {
    correlationId,
    source,
    sdkInitInvocation: sdkInitInvocationCount,
    appIdInitialized: true,
  });
}

function ensureSdkInitialized(appId: string, source: string, correlationId?: string): FbSdk {
  if (!window.FB?.login) {
    throw new Error("Facebook SDK init failed.");
  }
  runFbInit(appId, source, correlationId);
  return window.FB;
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
    try {
      const FB = ensureSdkInitialized(appId, "window_fb_already_present", correlationId);
      logFacebookOAuthDiagnostic("sdk_loaded", {
        correlationId,
        loadInvocation,
        path: "window_fb_already_present",
        reusedExistingPromise: false,
      });
      return Promise.resolve(FB);
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error("Facebook SDK init failed."));
    }
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
        const FB = ensureSdkInitialized(appId, "fbAsyncInit", correlationId);
        resolve(FB);
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
        try {
          const FB = ensureSdkInitialized(appId, `script_tag_${via}`, correlationId);
          logFacebookOAuthDiagnostic("sdk_loaded", {
            correlationId,
            loadInvocation,
            path: `script_tag_${via}`,
            fbAsyncInitFired,
          });
          resolve(FB);
        } catch (e) {
          logFacebookOAuthDiagnostic("sdk_init_failed", {
            correlationId,
            source: via,
            errorClass: e instanceof Error ? e.name : "Error",
          });
          reject(e instanceof Error ? e : new Error("Facebook SDK init failed."));
        }
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

function configuredFacebookAppId(): string | null {
  const appId = facebookOAuthWebAppId()?.trim();
  return appId || null;
}

function getReadyFacebookSdk(): FbSdk | null {
  const appId = configuredFacebookAppId();
  if (!appId || !window.FB?.login) return null;
  if (fbInitCompletedForAppId !== appId) return null;
  return window.FB;
}

/**
 * Start loading/initializing the Facebook SDK (idempotent). Call when auth UI mounts so
 * `FB.login()` can run in the same turn as the user's click.
 */
export function warmFacebookSdk(): Promise<void> {
  const appId = configuredFacebookAppId();
  if (!appId) {
    return Promise.resolve();
  }
  if (getReadyFacebookSdk()) {
    return Promise.resolve();
  }
  return loadFacebookSdk(appId).then(
    () => undefined,
    (err) => {
      throw err;
    },
  );
}

export function isFacebookSdkReady(): boolean {
  return getReadyFacebookSdk() != null;
}

function extractAccessToken(response: FbLoginStatus): string | null {
  const token = response.authResponse?.accessToken?.trim();
  if (!token) return null;
  const diagnostics = safeLoginResponseDiagnostics(response);
  if (diagnostics.outcome !== "connected_with_token") return null;
  return token;
}

function classifySdkLoginFailure(
  diagnostics: ReturnType<typeof safeLoginResponseDiagnostics>,
): FacebookLoginFailureKind {
  if (diagnostics.outcome === "not_authorized") {
    return "cancelled";
  }
  if (diagnostics.outcome === "unknown" && !diagnostics.hasAuthResponse) {
    return "callback_missing_auth";
  }
  if (diagnostics.outcome === "connected_without_token") {
    return "callback_missing_auth";
  }
  if (diagnostics.status === "connected" && !diagnostics.hasAuthResponse) {
    return "callback_missing_auth";
  }
  return "incomplete";
}

function facebookLoginErrorForFailure(
  kind: FacebookLoginFailureKind,
  diagnostics: ReturnType<typeof safeLoginResponseDiagnostics>,
): FacebookLoginError {
  const fbStatus = diagnostics.status;
  const fbOutcome = diagnostics.outcome;
  switch (kind) {
    case "cancelled":
      return new FacebookLoginError(kind, "Facebook login was cancelled.", { fbStatus, fbOutcome });
    case "callback_missing_auth":
      return new FacebookLoginError(
        kind,
        "Facebook sign-in could not be completed because Facebook did not return the required sign-in information.",
        { fbStatus, fbOutcome },
      );
    case "incomplete":
      return new FacebookLoginError(
        kind,
        "Facebook sign-in did not complete. Please try again.",
        { fbStatus, fbOutcome },
      );
    default:
      return new FacebookLoginError("generic", "Facebook login failed.", { fbStatus, fbOutcome });
  }
}

function logStorageAccessHint(correlationId: string): void {
  if (typeof document === "undefined" || typeof document.hasStorageAccess !== "function") {
    return;
  }
  void document
    .hasStorageAccess()
    .then((hasAccess) => {
      logFacebookOAuthDiagnostic("sdk_storage_access_hint", {
        correlationId,
        hasStorageAccess: hasAccess,
      });
    })
    .catch(() => {
      logFacebookOAuthDiagnostic("sdk_storage_access_hint", {
        correlationId,
        hasStorageAccess: null,
      });
    });
}

type LoginStatusRecoveryResult =
  | { recovered: true; token: string; diagnostics: ReturnType<typeof safeLoginResponseDiagnostics> }
  | { recovered: false };

function tryGetLoginStatusRecovery(
  FB: FbSdk,
  correlationId: string,
  loginInvocation: number,
  loginDiagnostics: ReturnType<typeof safeLoginResponseDiagnostics>,
): Promise<LoginStatusRecoveryResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (
      result: LoginStatusRecoveryResult,
      stage: string,
      extra: Record<string, unknown>,
    ) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      logFacebookOAuthDiagnostic(stage, {
        correlationId,
        loginInvocation,
        afterLoginOutcome: loginDiagnostics.outcome,
        afterLoginStatus: loginDiagnostics.status,
        ...extra,
      });
      resolve(result);
    };

    const timeout = window.setTimeout(() => {
      finish({ recovered: false }, "sdk_login_get_login_status_timeout", {
        elapsedMs: FB_GET_LOGIN_STATUS_RECOVERY_MS,
        case: "B",
      });
    }, FB_GET_LOGIN_STATUS_RECOVERY_MS);

    logFacebookOAuthDiagnostic("sdk_login_get_login_status_started", {
      correlationId,
      loginInvocation,
      forceRoundTrip: true,
      case: "B",
    });

    try {
      FB.getLoginStatus((statusResponse) => {
        const diagnostics = safeLoginResponseDiagnostics(statusResponse);
        const token = extractAccessToken(statusResponse);
        if (token) {
          finish(
            { recovered: true, token, diagnostics },
            "sdk_login_get_login_status_received",
            {
              ...diagnostics,
              recoverySucceeded: true,
              case: "E",
            },
          );
          return;
        }
        finish({ recovered: false }, "sdk_login_get_login_status_received", {
          ...diagnostics,
          recoverySucceeded: false,
          case: sdkOutcomeCase(diagnostics),
        });
      }, true);
    } catch (e) {
      finish({ recovered: false }, "sdk_login_get_login_status_threw", {
        errorClass: e instanceof Error ? e.name : "Error",
        case: "B",
      });
    }
  });
}

function invokeFacebookLogin(FB: FbSdk, correlationId: string, appId: string): Promise<string> {
  fbLoginInvocationCount += 1;
  const loginInvocation = fbLoginInvocationCount;
  const previousLoginCorrelationId = activeFbLoginCorrelationId;
  const concurrentLogin = previousLoginCorrelationId != null && previousLoginCorrelationId !== correlationId;
  activeFbLoginCorrelationId = correlationId;

  logFacebookOAuthDiagnostic("sdk_login_started", {
    correlationId,
    loginInvocation,
    concurrentLogin,
    sdkReadyBeforeLogin: true,
    ...loginEnvironmentSnapshot(appId),
    ...(previousLoginCorrelationId ? { previousLoginCorrelationId } : {}),
  });
  logStorageAccessHint(correlationId);

  return new Promise<string>((resolve, reject) => {
    let callbackReceived = false;
    let watchdog = 0;

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

    const failFromDiagnostics = (
      diagnostics: ReturnType<typeof safeLoginResponseDiagnostics>,
      reason: string,
      source: "login_callback" | "get_login_status_recovery",
    ) => {
      const failureKind = classifySdkLoginFailure(diagnostics);
      logFacebookOAuthDiagnostic("sdk_login_no_token", {
        correlationId,
        loginInvocation,
        case: sdkOutcomeCase(diagnostics),
        failureKind,
        source,
        reason,
        ...diagnostics,
        apiOAuthWillBeCalled: false,
      });
      finish("rejected", { outcome: diagnostics.outcome, reason, failureKind, source });
      clearFacebookOAuthDiagnostic();
      reject(facebookLoginErrorForFailure(failureKind, diagnostics));
    };

    const succeedWithToken = (
      token: string,
      diagnostics: ReturnType<typeof safeLoginResponseDiagnostics>,
      tokenSource: "login_callback" | "get_login_status_recovery",
    ) => {
      logFacebookOAuthDiagnostic("sdk_login_token_ready", {
        correlationId,
        loginInvocation,
        status: diagnostics.status,
        hasAccessToken: true,
        tokenSource,
        case: "E",
        ...(diagnostics.facebookUserId ? { facebookUserId: diagnostics.facebookUserId } : {}),
      });
      finish("resolved", { outcome: diagnostics.outcome, tokenSource });
      resolve(token);
    };

    const handleLoginResponse = async (response: FbLoginStatus, source: "login_callback") => {
      callbackReceived = true;
      const diagnostics = safeLoginResponseDiagnostics(response);
      logFacebookOAuthDiagnostic("sdk_login_callback_received", {
        correlationId,
        loginInvocation,
        case: sdkOutcomeCase(diagnostics),
        ...diagnostics,
      });

      const token = extractAccessToken(response);
      if (token) {
        succeedWithToken(token, diagnostics, "login_callback");
        return;
      }

      const recovery = await tryGetLoginStatusRecovery(
        FB,
        correlationId,
        loginInvocation,
        diagnostics,
      );
      if (recovery.recovered) {
        succeedWithToken(
          recovery.token,
          recovery.diagnostics,
          "get_login_status_recovery",
        );
        return;
      }

      failFromDiagnostics(diagnostics, "no_token_from_sdk", source);
    };

    watchdog = window.setTimeout(() => {
      if (!callbackReceived) {
        logFacebookOAuthDiagnostic("sdk_login_callback_never_fired", {
          correlationId,
          loginInvocation,
          elapsedMs: FB_LOGIN_CALLBACK_WATCHDOG_MS,
          case: "F",
          apiOAuthWillBeCalled: false,
        });
        finish("rejected", { reason: "watchdog_timeout", outcome: "watchdog_timeout" });
        clearFacebookOAuthDiagnostic();
        reject(
          new FacebookLoginError(
            "incomplete",
            "Facebook sign-in did not complete. Please try again.",
          ),
        );
      }
    }, FB_LOGIN_CALLBACK_WATCHDOG_MS);

    try {
      FB.login(
        (response) => {
          void handleLoginResponse(response, "login_callback");
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
      reject(
        new FacebookLoginError(
          "generic",
          "Facebook login failed.",
          { cause: e instanceof Error ? e : undefined },
        ),
      );
    }
  });
}

/**
 * Facebook user access token for CareTip OAuth (sent as idToken).
 * Requires a warmed SDK — call {@link warmFacebookSdk} before the user clicks so `FB.login` runs on the gesture.
 */
export function requestFacebookAccessToken(): Promise<string> {
  const correlationId = beginFacebookOAuthDiagnostic();
  logFacebookOAuthDiagnostic("requestFacebookAccessToken_started", { correlationId });

  const appId = configuredFacebookAppId();
  if (!appId) {
    logFacebookOAuthDiagnostic("requestFacebookAccessToken_rejected", {
      correlationId,
      reason: "app_id_not_configured",
    });
    clearFacebookOAuthDiagnostic();
    throw new FacebookLoginError(
      "not_configured",
      "Facebook Login is not configured (VITE_FACEBOOK_APP_ID).",
    );
  }

  if (activeFbLoginCorrelationId != null) {
    logFacebookOAuthDiagnostic("requestFacebookAccessToken_rejected", {
      correlationId,
      reason: "concurrent_login",
      activeLoginCorrelationId: activeFbLoginCorrelationId,
      apiOAuthWillBeCalled: false,
      case: "G",
    });
    clearFacebookOAuthDiagnostic();
    throw new FacebookLoginError("concurrent", "Facebook login is already in progress.");
  }

  const FB = getReadyFacebookSdk();
  if (!FB) {
    logFacebookOAuthDiagnostic("requestFacebookAccessToken_rejected", {
      correlationId,
      reason: "sdk_not_ready_on_click",
      apiOAuthWillBeCalled: false,
      windowFbPresent: Boolean(window.FB),
      initCompletedForAppId: fbInitCompletedForAppId,
    });
    clearFacebookOAuthDiagnostic();
    throw new FacebookLoginError(
      "sdk_not_ready",
      "Facebook is still loading. Wait a moment and try again.",
    );
  }

  return invokeFacebookLogin(FB, correlationId, appId);
}
