import { facebookOAuthWebAppId } from "./oauthProviderIds";
import {
  attachFacebookAttemptLifecycle,
  msSinceClick,
  msSinceFbInvoke,
  type FacebookAttemptLifecycle,
} from "./facebookOAuthAttemptLifecycle";
import { classifySdkLoginFailure } from "./facebookOAuthClassification";
import {
  noCallbackNoPopupGraceAfterProbeMs,
  noObservablePopupInteraction,
  shouldEarlyTerminateNoCallbackAttempt,
} from "./facebookOAuthNoInteraction";
import {
  beginFacebookOAuthDiagnostic,
  clearFacebookOAuthDiagnostic,
  logFacebookOAuthDiagnostic,
  restoreFacebookOAuthDiagnosticId,
  setActiveFacebookOAuthDiagnosticId,
  type FacebookOAuthDiagnosticCase,
} from "./facebookOAuthDiagnostic";
import { FacebookLoginError, type FacebookLoginFailureKind } from "./facebookLoginError";
import type { FbLoginOutcome } from "./facebookOAuthWeb.types";

export type { FbLoginOutcome } from "./facebookOAuthWeb.types";

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
/** After the no-callback watchdog fires, wait for a late FB.login callback before rejecting. */
const FB_WATCHDOG_REJECT_GRACE_MS = 30_000;
/** If no callback yet, record a popup/consent stall probe (not a failure by itself). */
const FB_LOGIN_POPUP_PROBE_MS = 5_000;

export type FacebookOAuthClickContext = {
  perfNow: number;
  userActivationIsActive: boolean | null;
  userActivationHasBeenActive: boolean | null;
};

type OrphanedFacebookTokenHandler = (
  token: string,
  meta: { correlationId: string; loginInvocation: number },
) => void;

let orphanedFacebookTokenHandler: OrphanedFacebookTokenHandler | null = null;

/** Delivers a token when the login promise already rejected but Facebook returns late (same attempt). */
export function registerFacebookOrphanedTokenHandler(handler: OrphanedFacebookTokenHandler | null): void {
  orphanedFacebookTokenHandler = handler;
}

export function captureFacebookOAuthClickContext(): FacebookOAuthClickContext {
  const ua = typeof navigator !== "undefined" ? navigator.userActivation : undefined;
  return {
    perfNow: typeof performance !== "undefined" ? performance.now() : 0,
    userActivationIsActive: ua?.isActive ?? null,
    userActivationHasBeenActive: ua?.hasBeenActive ?? null,
  };
}

function userActivationCheckpoint(
  stage: string,
  fields: Record<string, unknown> & { correlationId?: string },
): void {
  const ua = typeof navigator !== "undefined" ? navigator.userActivation : undefined;
  logFacebookOAuthDiagnostic(stage, {
    perfNow: typeof performance !== "undefined" ? performance.now() : 0,
    userActivationIsActive: ua?.isActive ?? null,
    userActivationHasBeenActive: ua?.hasBeenActive ?? null,
    documentVisibilityState:
      typeof document !== "undefined" ? document.visibilityState : "unknown",
    windowFbExists: typeof window !== "undefined" ? Boolean(window.FB) : false,
    sdkReady: typeof window !== "undefined" ? getReadyFacebookSdk() != null : false,
    fbLoginInvocationCount,
    ...fields,
  });
}

let fbSdkPromise: Promise<FbSdk> | null = null;
let sdkLoadInvocationCount = 0;
let sdkInitInvocationCount = 0;
let fbLoginInvocationCount = 0;
let fbInitCompletedForAppId: string | null = null;
let activeFbLoginCorrelationId: string | null = null;
/** After reject, only this attempt may deliver an orphan token (not a newer click). */
let orphanEligibleCorrelationId: string | null = null;

/** Test-only: mark SDK initialized without loading script. */
export function markFacebookSdkReadyForTesting(appId: string): void {
  fbInitCompletedForAppId = appId;
}

export function resetFacebookOAuthWebStateForTesting(): void {
  fbSdkPromise = null;
  sdkLoadInvocationCount = 0;
  sdkInitInvocationCount = 0;
  fbLoginInvocationCount = 0;
  fbInitCompletedForAppId = null;
  activeFbLoginCorrelationId = null;
  orphanEligibleCorrelationId = null;
  orphanedFacebookTokenHandler = null;
  clearFacebookOAuthDiagnostic();
}

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
  if (fbInitCompletedForAppId) {
    return fbInitCompletedForAppId;
  }
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
    case "session_bridge_unverified":
      return new FacebookLoginError(
        kind,
        "Facebook sign-in could not be completed because Facebook did not return the required sign-in information.",
        { fbStatus, fbOutcome },
      );
    case "popup_unverified":
      return new FacebookLoginError(
        kind,
        "Facebook sign-in could not be completed because Facebook did not return the required sign-in information.",
        { fbStatus, fbOutcome },
      );
    case "popup_blocked":
      return new FacebookLoginError(
        kind,
        "Facebook could not open because your browser blocked the sign-in window.",
        { fbStatus, fbOutcome },
      );
    case "oauth_interaction_not_observed":
      return new FacebookLoginError(
        kind,
        "Facebook sign-in could not open or complete. Allow pop-ups for CareTip and try again.",
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

function startStorageAccessHint(correlationId: string): Promise<boolean | null> {
  if (typeof document === "undefined" || typeof document.hasStorageAccess !== "function") {
    return Promise.resolve(null);
  }
  return document
    .hasStorageAccess()
    .then((hasAccess) => {
      logFacebookOAuthDiagnostic("sdk_storage_access_hint", {
        correlationId,
        hasStorageAccess: hasAccess,
      });
      return hasAccess;
    })
    .catch(() => {
      logFacebookOAuthDiagnostic("sdk_storage_access_hint", {
        correlationId,
        hasStorageAccess: null,
      });
      return null;
    });
}

function callbackForensicFields(
  clickContext: FacebookOAuthClickContext | undefined,
  attemptLifecycle: FacebookAttemptLifecycle | null,
  storageAccess: boolean | null,
): Record<string, unknown> {
  const lifecycle = attemptLifecycle?.snapshot();
  const clickPerf = clickContext?.perfNow;
  const invokePerf = attemptLifecycle?.fbLoginInvokePerfNow ?? null;
  return {
    msSinceUserClick: clickPerf != null ? msSinceClick(clickPerf) : null,
    msSinceFbLoginInvoke:
      clickPerf != null ? msSinceFbInvoke(clickPerf, invokePerf) : null,
    documentVisibilityState:
      typeof document !== "undefined" ? document.visibilityState : "unknown",
    documentHasFocus: typeof document !== "undefined" ? document.hasFocus() : null,
    navigatorCookieEnabled:
      typeof navigator !== "undefined" ? Boolean(navigator.cookieEnabled) : null,
    hasStorageAccess: storageAccess,
    ...(lifecycle
      ? {
          attemptLifecycle: lifecycle,
          popupObserved: lifecycle.popupLifecycleObserved !== "unknown",
          popupLifecycleUnknown: lifecycle.popupLifecycleObserved === "unknown",
        }
      : {
          popupObserved: false,
          popupLifecycleUnknown: true,
        }),
  };
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

function invokeFacebookLogin(
  FB: FbSdk,
  correlationId: string,
  appId: string,
  clickContext?: FacebookOAuthClickContext,
  attemptLifecycle?: FacebookAttemptLifecycle | null,
  readStorageAccessHint: () => boolean | null = () => null,
): Promise<string> {
  fbLoginInvocationCount += 1;
  const loginInvocation = fbLoginInvocationCount;
  const previousLoginCorrelationId = activeFbLoginCorrelationId;
  const concurrentLogin = previousLoginCorrelationId != null && previousLoginCorrelationId !== correlationId;
  activeFbLoginCorrelationId = correlationId;
  if (orphanEligibleCorrelationId !== correlationId) {
    orphanEligibleCorrelationId = null;
  }

  logFacebookOAuthDiagnostic("sdk_login_started", {
    correlationId,
    loginInvocation,
    concurrentLogin,
    sdkReadyBeforeLogin: true,
    ...loginEnvironmentSnapshot(appId),
    ...(previousLoginCorrelationId ? { previousLoginCorrelationId } : {}),
  });

  const disposeLifecycle = () => {
    attemptLifecycle?.dispose();
  };

  return new Promise<string>((resolve, reject) => {
    let callbackReceived = false;
    type DeliveryState = "pending" | "fulfilled" | "rejected";
    let deliveryState: DeliveryState = "pending";
    let watchdog = 0;
    let postCallbackWatchdog = 0;
    let pendingRejectTimer = 0;
    let watchdogRejectScheduled = false;
    let popupProbeTimer = 0;
    let noInteractionTerminateTimer = 0;
    let popupProbeNoCallback = false;

    const clearAllTimers = () => {
      window.clearTimeout(watchdog);
      window.clearTimeout(postCallbackWatchdog);
      window.clearTimeout(pendingRejectTimer);
      window.clearTimeout(popupProbeTimer);
      window.clearTimeout(noInteractionTerminateTimer);
      pendingRejectTimer = 0;
      popupProbeTimer = 0;
      noInteractionTerminateTimer = 0;
    };

    const scheduleNoInteractionTerminationCheck = (source: "popup_probe" | "grace_timer") => {
      const lifecycleSnap = attemptLifecycle?.snapshot();
      const popupObserved = lifecycleSnap
        ? lifecycleSnap.popupLifecycleObserved !== "unknown"
        : false;
      const canTerminate = shouldEarlyTerminateNoCallbackAttempt({
        callbackReceived,
        deliveryPending: deliveryState === "pending",
        lifecycle: lifecycleSnap,
      });
      logFacebookOAuthDiagnostic("sdk_login_no_interaction_check", {
        correlationId,
        loginInvocation,
        source,
        callbackReceived,
        popupProbeNoCallback,
        popupObserved,
        popupLifecycleUnknown: !popupObserved,
        canTerminate,
        notProofOfPopupBlocked: true,
        graceAfterProbeMs: noCallbackNoPopupGraceAfterProbeMs(),
        ...callbackForensicFields(clickContext, attemptLifecycle ?? null, readStorageAccessHint()),
      });
      if (!canTerminate) {
        return;
      }
      const err = new FacebookLoginError(
        "oauth_interaction_not_observed",
        "Facebook sign-in could not open or complete. Allow pop-ups for CareTip and try again.",
      );
      scheduleFailure(err, "no_callback_no_observable_popup", 0, {
        failureKind: "oauth_interaction_not_observed",
        outcome: "no_callback_no_observable_popup",
        popupProbeNoCallback,
        popupObserved,
      });
    };

    const releaseActiveLogin = () => {
      if (activeFbLoginCorrelationId === correlationId) {
        activeFbLoginCorrelationId = null;
      }
    };

    const finish = (outcome: "resolved" | "rejected", extra: Record<string, unknown>) => {
      logFacebookOAuthDiagnostic(`requestFacebookAccessToken_${outcome}`, {
        correlationId,
        loginInvocation,
        apiOAuthWillBeCalled: outcome === "resolved",
        ...extra,
      });
    };

    const deliverToken = (
      token: string,
      diagnostics: ReturnType<typeof safeLoginResponseDiagnostics>,
      tokenSource: "login_callback" | "get_login_status_recovery",
      recoveredAfterPendingReject = false,
    ) => {
      if (deliveryState === "fulfilled") return;
      if (deliveryState === "rejected") {
        logFacebookOAuthDiagnostic("sdk_login_token_after_promise_rejected", {
          correlationId,
          loginInvocation,
          tokenSource,
          case: "E",
          apiOAuthWillBeCalled: false,
        });
        if (
          orphanedFacebookTokenHandler &&
          orphanEligibleCorrelationId === correlationId &&
          activeFbLoginCorrelationId === null
        ) {
          logFacebookOAuthDiagnostic("sdk_login_orphan_token_delivery", {
            correlationId,
            loginInvocation,
            tokenSource,
            case: "E",
          });
          restoreFacebookOAuthDiagnosticId(correlationId);
          orphanEligibleCorrelationId = null;
          orphanedFacebookTokenHandler(token, { correlationId, loginInvocation });
        }
        return;
      }
      clearAllTimers();
      disposeLifecycle();
      if (recoveredAfterPendingReject || watchdogRejectScheduled) {
        logFacebookOAuthDiagnostic("sdk_login_late_token_recovery", {
          correlationId,
          loginInvocation,
          tokenSource,
          case: "E",
          recoveredAfterWatchdog: watchdogRejectScheduled,
          priorDeliveryState: deliveryState,
        });
      }
      deliveryState = "fulfilled";
      orphanEligibleCorrelationId = null;
      releaseActiveLogin();
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

    const commitFailure = (
      err: FacebookLoginError,
      extra: Record<string, unknown>,
    ) => {
      if (deliveryState === "fulfilled") return;
      if (deliveryState === "rejected") return;
      deliveryState = "rejected";
      clearAllTimers();
      disposeLifecycle();
      releaseActiveLogin();
      orphanEligibleCorrelationId = correlationId;
      finish("rejected", extra);
      reject(err);
    };

    const scheduleFailure = (
      err: FacebookLoginError,
      reason: string,
      graceMs: number,
      extra: Record<string, unknown> = {},
    ) => {
      if (deliveryState !== "pending") return;
      window.clearTimeout(pendingRejectTimer);
      if (reason === "watchdog_timeout") {
        watchdogRejectScheduled = true;
      }
      logFacebookOAuthDiagnostic("sdk_login_failure_scheduled", {
        correlationId,
        loginInvocation,
        reason,
        graceMs,
        callbackReceived,
        ...extra,
      });
      pendingRejectTimer = window.setTimeout(() => {
        if (deliveryState !== "pending") return;
        if (reason === "watchdog_timeout" && callbackReceived) {
          return;
        }
        logFacebookOAuthDiagnostic("sdk_login_flow_aborted", {
          correlationId,
          loginInvocation,
          reason,
          failureKind: err.kind,
          case: reason === "watchdog_timeout" ? "F" : "B",
        });
        commitFailure(err, { reason, failureKind: err.kind, ...extra });
      }, graceMs);
    };

    const failFromDiagnostics = (
      diagnostics: ReturnType<typeof safeLoginResponseDiagnostics>,
      reason: string,
      source: "login_callback" | "get_login_status_recovery",
    ) => {
      const lifecycleSnap = attemptLifecycle?.snapshot();
      const failureKind = classifySdkLoginFailure(diagnostics, {
        lifecycle: lifecycleSnap
          ? {
              popupLifecycleObserved: lifecycleSnap.popupLifecycleObserved,
              sawVisibleAfterHidden: lifecycleSnap.sawVisibleAfterHidden,
            }
          : undefined,
      });
      logFacebookOAuthDiagnostic("sdk_login_no_token", {
        correlationId,
        loginInvocation,
        case: sdkOutcomeCase(diagnostics),
        failureKind,
        source,
        reason,
        ...diagnostics,
        ...callbackForensicFields(clickContext, attemptLifecycle ?? null, readStorageAccessHint()),
        apiOAuthWillBeCalled: false,
      });
      scheduleFailure(
        facebookLoginErrorForFailure(failureKind, diagnostics),
        reason,
        0,
        { outcome: diagnostics.outcome, failureKind, source },
      );
    };

    const succeedWithToken = (
      token: string,
      diagnostics: ReturnType<typeof safeLoginResponseDiagnostics>,
      tokenSource: "login_callback" | "get_login_status_recovery",
    ) => {
      deliverToken(
        token,
        diagnostics,
        tokenSource,
        watchdogRejectScheduled || deliveryState === "rejected",
      );
    };

    const rejectLoginFlow = (
      kind: FacebookLoginFailureKind,
      reason: string,
      diagnostics?: ReturnType<typeof safeLoginResponseDiagnostics>,
    ) => {
      const err = diagnostics
        ? facebookLoginErrorForFailure(kind, diagnostics)
        : new FacebookLoginError(kind, "Facebook sign-in did not complete. Please try again.");
      scheduleFailure(err, reason, 0, {
        failureKind: kind,
        case: diagnostics ? sdkOutcomeCase(diagnostics) : "B",
      });
    };

    const handleLoginResponse = async (response: FbLoginStatus, source: "login_callback") => {
      callbackReceived = true;
      window.clearTimeout(pendingRejectTimer);
      window.clearTimeout(noInteractionTerminateTimer);
      noInteractionTerminateTimer = 0;
      watchdogRejectScheduled = false;
      postCallbackWatchdog = window.setTimeout(() => {
        if (deliveryState !== "pending") return;
          logFacebookOAuthDiagnostic("sdk_login_post_callback_timeout", {
            correlationId,
            loginInvocation,
            elapsedMs: FB_GET_LOGIN_STATUS_RECOVERY_MS + 5_000,
            case: "F",
            apiOAuthWillBeCalled: false,
          });
          rejectLoginFlow("incomplete", "post_callback_processing_timeout");
      }, FB_GET_LOGIN_STATUS_RECOVERY_MS + 5_000);
      const diagnostics = safeLoginResponseDiagnostics(response);
      logFacebookOAuthDiagnostic("sdk_login_callback_received", {
        correlationId,
        loginInvocation,
        case: sdkOutcomeCase(diagnostics),
        ...diagnostics,
        ...callbackForensicFields(clickContext, attemptLifecycle ?? null, readStorageAccessHint()),
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
      if (callbackReceived || deliveryState !== "pending") return;
      logFacebookOAuthDiagnostic("sdk_login_callback_never_fired", {
        correlationId,
        loginInvocation,
        elapsedMs: FB_LOGIN_CALLBACK_WATCHDOG_MS,
        case: "F",
        apiOAuthWillBeCalled: false,
        rejectGraceMs: FB_WATCHDOG_REJECT_GRACE_MS,
      });
      // Defer one macrotask so an FB.login callback in the same tick wins the race.
      window.setTimeout(() => {
        if (callbackReceived || deliveryState !== "pending") return;
        scheduleFailure(
          new FacebookLoginError(
            "incomplete",
            "Facebook sign-in did not complete. Please try again.",
          ),
          "watchdog_timeout",
          FB_WATCHDOG_REJECT_GRACE_MS,
          {
            outcome: "watchdog_timeout",
            popupProbeNoCallback,
          },
        );
      }, 0);
    }, FB_LOGIN_CALLBACK_WATCHDOG_MS);

    popupProbeTimer = window.setTimeout(() => {
      if (callbackReceived || deliveryState !== "pending") return;
      popupProbeNoCallback = true;
      userActivationCheckpoint("sdk_login_popup_probe", {
        correlationId,
        loginInvocation,
        elapsedMs: FB_LOGIN_POPUP_PROBE_MS,
        probeKind: "heuristic_no_callback_yet",
        popupProbeNoCallback: true,
        notProofOfPopupBlocked: true,
        ...(clickContext ? { clickUserActivationIsActive: clickContext.userActivationIsActive } : {}),
        ...callbackForensicFields(clickContext, attemptLifecycle ?? null, readStorageAccessHint()),
      });
      if (
        !callbackReceived &&
        deliveryState === "pending" &&
        noObservablePopupInteraction(attemptLifecycle?.snapshot())
      ) {
        noInteractionTerminateTimer = window.setTimeout(() => {
          if (callbackReceived || deliveryState !== "pending") return;
          scheduleNoInteractionTerminationCheck("grace_timer");
        }, noCallbackNoPopupGraceAfterProbeMs());
      } else {
        logFacebookOAuthDiagnostic("sdk_login_no_interaction_grace_skipped", {
          correlationId,
          loginInvocation,
          reason: "popup_or_focus_activity_observed",
          notProofOfPopupBlocked: true,
        });
      }
    }, FB_LOGIN_POPUP_PROBE_MS);

    try {
      userActivationCheckpoint("sdk_login_before_fb_login", {
        correlationId,
        loginInvocation,
        ...(clickContext
          ? {
              clickPerfNow: clickContext.perfNow,
              clickUserActivationIsActive: clickContext.userActivationIsActive,
              clickUserActivationHasBeenActive: clickContext.userActivationHasBeenActive,
            }
          : {}),
      });
      attemptLifecycle?.markFbLoginInvoked();
      FB.login(
        (response) => {
          void handleLoginResponse(response, "login_callback").catch((e) => {
            logFacebookOAuthDiagnostic("sdk_login_callback_handler_error", {
              correlationId,
              loginInvocation,
              errorClass: e instanceof Error ? e.name : "Error",
              case: "B",
            });
            rejectLoginFlow("generic", "login_callback_handler_error");
          });
        },
        { scope: "email,public_profile", return_scopes: true },
      );
      logFacebookOAuthDiagnostic("sdk_login_invoke", {
        correlationId,
        loginInvocation,
      });
      userActivationCheckpoint("sdk_login_after_fb_login_invoke", {
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
      commitFailure(
        new FacebookLoginError(
          "generic",
          "Facebook login failed.",
          { cause: e instanceof Error ? e : undefined },
        ),
        { reason: "fb_login_exception" },
      );
    }
  });
}

/**
 * Facebook user access token for CareTip OAuth (sent as idToken).
 * Requires a warmed SDK — call {@link warmFacebookSdk} before the user clicks so `FB.login` runs on the gesture.
 */
export function requestFacebookAccessToken(
  clickContext?: FacebookOAuthClickContext,
  existingCorrelationId?: string,
): Promise<string> {
  const correlationId = existingCorrelationId ?? beginFacebookOAuthDiagnostic();
  if (existingCorrelationId) {
    setActiveFacebookOAuthDiagnosticId(existingCorrelationId);
  }
  const storageAccessRef: { hint: boolean | null } = { hint: null };
  void startStorageAccessHint(correlationId).then((hint) => {
    storageAccessRef.hint = hint;
  });
  let attemptLifecycle: FacebookAttemptLifecycle | null = null;
  if (clickContext) {
    attemptLifecycle = attachFacebookAttemptLifecycle(correlationId, clickContext.perfNow);
  }
  const disposeAttemptLifecycle = () => {
    attemptLifecycle?.dispose();
    attemptLifecycle = null;
  };
  userActivationCheckpoint("requestFacebookAccessToken_started", {
    correlationId,
    ...(clickContext
      ? {
          clickPerfNow: clickContext.perfNow,
          clickUserActivationIsActive: clickContext.userActivationIsActive,
          clickUserActivationHasBeenActive: clickContext.userActivationHasBeenActive,
        }
      : {}),
  });

  const appId = configuredFacebookAppId();
  if (!appId) {
    disposeAttemptLifecycle();
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
    disposeAttemptLifecycle();
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
    disposeAttemptLifecycle();
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

  return invokeFacebookLogin(
    FB,
    correlationId,
    appId,
    clickContext,
    attemptLifecycle,
    () => storageAccessRef.hint,
  );
}
