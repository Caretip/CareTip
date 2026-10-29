import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { CredentialResponse } from "@react-oauth/google";
import { AuthGoogleLoginButton } from "@/app/components/auth/AuthGoogleLoginButton";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { googleOAuthWebClientId } from "@/app/lib/googleOAuthWebClientId";
import {
  appleOAuthWebClientId,
  facebookOAuthWebAppId,
  type OAuthProviderId,
} from "@/app/lib/oauthProviderIds";
import { OAUTH_LOGO_SRC } from "@/app/lib/oauthLogos";
import { requestAppleIdToken, isAppleSdkAvailable } from "@/app/lib/appleOAuthWeb";
import {
  captureFacebookOAuthClickContext,
  isFacebookSdkReady,
  registerFacebookOrphanedTokenHandler,
  requestFacebookAccessToken,
  warmFacebookSdk,
} from "@/app/lib/facebookOAuthWeb";
import {
  isFacebookOAuthRedirectEnabled,
  submitFacebookOAuthRedirectStart,
  type FacebookRedirectStartContext,
} from "@/app/lib/facebookOAuthRedirectWeb";
import { beginFacebookOAuthDiagnostic } from "@/app/lib/facebookOAuthDiagnostic";
import { isFacebookLoginError } from "@/app/lib/facebookLoginError";
import { presentFacebookLoginError } from "@/app/lib/facebookOAuthPresent";
import { logFacebookOAuthDiagnostic } from "@/app/lib/facebookOAuthDiagnostic";
import { logClientError } from "@/app/lib/clientLog";
import { toUserFriendlyMessage } from "@/app/lib/errorMessages";
import { AuthGoogleOAuthScope } from "@/app/components/auth/AuthGoogleOAuthScope";
import { FacebookOAuthInlineStatus } from "@/app/components/auth/FacebookOAuthInlineStatus";
import {
  applyFacebookPhaseIfCurrent,
  beginFacebookAttempt,
  FACEBOOK_OAUTH_IDLE,
  facebookProviderShowsLoading,
  type FacebookOAuthAttemptState,
} from "@/app/lib/facebookProviderAttempt";
import {
  focusCurrentAuthEmailField,
  isFacebookOAuthRecoveryClient,
  watchFacebookOAuthRedirectRecovery,
  type FacebookOAuthRecoveryWatch,
} from "@/app/lib/facebookOAuthRedirectRecovery";
import "@/styles/caretip-oauth-circles.css";

/** Desktop / mobile-web order. Apple and Facebook sign-in are hidden from the UI. */
export const WEB_OAUTH_PROVIDER_ORDER: readonly OAuthProviderId[] = ["google"] as const;

function OAuthLogoButton({
  provider,
  label,
  title,
  disabled,
  loading,
  onClick,
  children,
}: {
  provider: OAuthProviderId;
  label: string;
  title?: string;
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title ?? label}
      disabled={disabled || loading}
      onClick={onClick}
      className={cn(
        "caretip-oauth-circle caretip-oauth-circle--asset",
        `caretip-oauth-circle--${provider}`,
        loading && "caretip-oauth-circle--loading",
      )}
    >
      {loading ? (
        <span className="caretip-oauth-circle__spinner" aria-hidden />
      ) : (
        <img
          src={OAUTH_LOGO_SRC[provider]}
          alt=""
          aria-hidden
          width={44}
          height={44}
          decoding="async"
          className="caretip-oauth-circle__logo"
          draggable={false}
        />
      )}
      {children}
    </button>
  );
}

export type OAuthProviderRowProps = {
  disabled?: boolean;
  allowInteraction?: boolean;
  blockedTitle?: string;
  className?: string;
  onSocialCredential: (provider: OAuthProviderId, idToken: string) => void;
  ariaLabel?: string;
  /** When set and redirect mode is on, Facebook uses server OAuth instead of FB.login(). */
  facebookRedirectContext?: FacebookRedirectStartContext | null;
};

/**
 * Shared circular OAuth provider row — approved template logos, equal spacing.
 */
export function OAuthProviderRow({
  disabled = false,
  allowInteraction = true,
  blockedTitle,
  className,
  onSocialCredential,
  ariaLabel,
  facebookRedirectContext = null,
}: OAuthProviderRowProps) {
  const { t } = useTranslation();
  const googleClientId = googleOAuthWebClientId();
  const appleClientId = appleOAuthWebClientId();
  const facebookAppId = facebookOAuthWebAppId();
  const [gsiOriginError, setGsiOriginError] = useState(false);
  const [appleReady, setAppleReady] = useState<boolean | null>(null);
  const [facebookWarmState, setFacebookWarmState] = useState<"loading" | "ready" | "failed">(() =>
    isFacebookSdkReady() ? "ready" : "loading",
  );
  const [providerBusy, setProviderBusy] = useState<OAuthProviderId | null>(null);
  const [facebookAttempt, setFacebookAttempt] = useState<FacebookOAuthAttemptState>(FACEBOOK_OAUTH_IDLE);
  const facebookRecoveryWatchRef = useRef<FacebookOAuthRecoveryWatch | null>(null);
  const authModeRef = useRef(facebookRedirectContext?.isLogin);

  useEffect(() => {
    if (!facebookProviderShowsLoading(facebookAttempt)) return;
    if (isFacebookOAuthRedirectEnabled() && facebookRedirectContext) return;
    const safetyMs = 150_000;
    const attemptId = facebookAttempt.attemptId;
    const timer = window.setTimeout(() => {
      logFacebookOAuthDiagnostic("oauth_provider_busy_safety_reset", {
        provider: "facebook",
        elapsedMs: safetyMs,
        attemptId,
      });
      setFacebookAttempt((current) =>
        applyFacebookPhaseIfCurrent(current, attemptId, "timeout", "timeout"),
      );
    }, safetyMs);
    return () => window.clearTimeout(timer);
  }, [facebookAttempt, facebookRedirectContext]);

  useEffect(() => {
    if (!facebookAppId) {
      setFacebookWarmState("failed");
      return;
    }
    if (isFacebookSdkReady()) {
      setFacebookWarmState("ready");
      return;
    }
    setFacebookWarmState("loading");
    let cancelled = false;
    logFacebookOAuthDiagnostic("sdk_warm_started", { source: "OAuthProviderRow" });
    void warmFacebookSdk()
      .then(() => {
        if (!cancelled) setFacebookWarmState("ready");
        logFacebookOAuthDiagnostic("sdk_warm_completed", { source: "OAuthProviderRow" });
      })
      .catch(() => {
        if (!cancelled) setFacebookWarmState("failed");
        logFacebookOAuthDiagnostic("sdk_warm_failed", { source: "OAuthProviderRow" });
      });
    return () => {
      cancelled = true;
    };
  }, [facebookAppId]);

  useEffect(() => {
    if (!appleClientId) {
      setAppleReady(null);
      return;
    }
    let cancelled = false;
    void isAppleSdkAvailable().then((ok) => {
      if (!cancelled) setAppleReady(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [appleClientId]);

  const resetFacebookAttempt = useCallback(() => {
    facebookRecoveryWatchRef.current?.dispose();
    facebookRecoveryWatchRef.current = null;
    setFacebookAttempt(FACEBOOK_OAUTH_IDLE);
  }, []);

  const releaseFacebookRedirectAttempt = useCallback(() => {
    resetFacebookAttempt();
  }, [resetFacebookAttempt]);

  const handleSocialCredential = useCallback(
    (provider: OAuthProviderId, idToken: string) => {
      if (provider === "facebook") {
        resetFacebookAttempt();
      }
      onSocialCredential(provider, idToken);
    },
    [onSocialCredential, resetFacebookAttempt],
  );

  const onGoogleSuccess = useCallback(
    (cred: CredentialResponse) => {
      setGsiOriginError(false);
      if (cred.credential) handleSocialCredential("google", cred.credential);
    },
    [handleSocialCredential],
  );

  const onGoogleError = useCallback(() => {
    setGsiOriginError(true);
    toast.error(
      t("auth.oauth.googleOriginError", {
        origin: typeof window !== "undefined" ? window.location.origin : "",
      }),
      { id: "caretip-google-gsi-error" },
    );
  }, [t]);

  const showGoogle = Boolean(googleClientId?.trim());
  const showApple = Boolean(appleClientId);
  const showFacebook = Boolean(facebookAppId);
  const anyProvider = showGoogle;

  const interactionBlocked = !allowInteraction;
  const facebookLoading = facebookProviderShowsLoading(facebookAttempt);
  const busy =
    disabled || interactionBlocked || providerBusy != null || facebookLoading;

  useEffect(() => {
    registerFacebookOrphanedTokenHandler((token, meta) => {
      logFacebookOAuthDiagnostic("oauth_orphan_token_recovery", {
        provider: "facebook",
        correlationId: meta.correlationId,
        loginInvocation: meta.loginInvocation,
        apiOAuthWillBeCalled: true,
      });
      handleSocialCredential("facebook", token);
    });
    return () => registerFacebookOrphanedTokenHandler(null);
  }, [handleSocialCredential]);

  useEffect(() => () => facebookRecoveryWatchRef.current?.dispose(), []);

  useEffect(() => {
    const isLogin = facebookRedirectContext?.isLogin;
    if (authModeRef.current === isLogin) return;
    authModeRef.current = isLogin;
    releaseFacebookRedirectAttempt();
  }, [facebookRedirectContext?.isLogin, releaseFacebookRedirectAttempt]);

  const toastNotConfigured = () => {
    toast.error(t("auth.oauth.providerNotConfigured"));
  };

  const toastFacebookLoginError = useCallback(
    (e: unknown) => {
      if (!isFacebookLoginError(e)) {
        logClientError("OAuthProviderRow.facebook", e);
        toast.error(toUserFriendlyMessage(e) || t("auth.oauth.providerFailed", { provider: "Facebook" }));
        return;
      }
      presentFacebookLoginError(e, t, {
        onSdkWarmRetry: () => setFacebookWarmState("ready"),
        onNotConfigured: toastNotConfigured,
        onGeneric: (message) => toast.error(message),
      });
    },
    [t],
  );

  const runFacebookLogin = useCallback(() => {
    const clickContext = captureFacebookOAuthClickContext();
    const correlationId = beginFacebookOAuthDiagnostic();
    logFacebookOAuthDiagnostic("oauth_facebook_button_click", {
      correlationId,
      provider: "facebook",
      interactionBlocked,
      disabled,
      providerBusy: providerBusy ?? null,
      facebookWarmState,
      sdkReadyOnClick: isFacebookSdkReady(),
      clickPerfNow: clickContext.perfNow,
      clickUserActivationIsActive: clickContext.userActivationIsActive,
      clickUserActivationHasBeenActive: clickContext.userActivationHasBeenActive,
    });
    if (interactionBlocked || disabled) {
      logFacebookOAuthDiagnostic("oauth_row_click_ignored", {
        provider: "facebook",
        interactionBlocked,
        disabled,
        providerBusy: providerBusy ?? null,
        facebookWarmState,
      });
      return;
    }
    if (providerBusy != null || facebookProviderShowsLoading(facebookAttempt)) {
      logFacebookOAuthDiagnostic("oauth_row_click_ignored", {
        provider: "facebook",
        reason: "provider_busy",
        providerBusy,
        facebookPhase: facebookAttempt.phase,
        facebookWarmState,
      });
      return;
    }
    if (!showFacebook) {
      toastNotConfigured();
      return;
    }
    if (isFacebookOAuthRedirectEnabled() && facebookRedirectContext) {
      logFacebookOAuthDiagnostic("oauth_facebook_redirect_start", {
        correlationId,
        isLogin: facebookRedirectContext.isLogin,
      });
      const next = beginFacebookAttempt(facebookAttempt);
      const attemptId = next.attemptId;
      setFacebookAttempt({ attemptId, phase: "redirecting" });
      facebookRecoveryWatchRef.current?.dispose();
      facebookRecoveryWatchRef.current = watchFacebookOAuthRedirectRecovery({
        isRecoveryClient: isFacebookOAuthRecoveryClient(
          typeof navigator === "undefined" ? "" : navigator.userAgent,
        ),
        onStall: () => {
          setFacebookAttempt((current) =>
            applyFacebookPhaseIfCurrent(current, attemptId, "timeout", "timeout"),
          );
        },
        onNavigateAway: () => {
          setFacebookAttempt((current) =>
            applyFacebookPhaseIfCurrent(current, attemptId, "awaiting_callback"),
          );
        },
      });
      submitFacebookOAuthRedirectStart(
        { ...facebookRedirectContext, correlationId },
        "/api/auth/facebook/start",
        () => {
          setFacebookAttempt((current) =>
            applyFacebookPhaseIfCurrent(current, attemptId, "error", "start_failed"),
          );
          facebookRecoveryWatchRef.current?.dispose();
          facebookRecoveryWatchRef.current = null;
        },
      );
      facebookRecoveryWatchRef.current?.armStallTimer();
      return;
    }
    if (!isFacebookSdkReady()) {
      logFacebookOAuthDiagnostic("oauth_facebook_click_sdk_not_ready", {
        correlationId,
        facebookWarmState,
      });
      toast.message(t("auth.oauth.facebookSdkLoading"), { id: "caretip-fb-warm" });
      void warmFacebookSdk()
        .then(() => setFacebookWarmState("ready"))
        .catch(() => setFacebookWarmState("failed"));
      return;
    }
    const next = beginFacebookAttempt(facebookAttempt);
    const attemptId = next.attemptId;
    setFacebookAttempt({ attemptId, phase: "loading" });
    try {
      const tokenPromise = requestFacebookAccessToken(clickContext, correlationId);
      void tokenPromise
        .then((idToken) => {
          setFacebookAttempt((current) =>
            applyFacebookPhaseIfCurrent(current, attemptId, "success"),
          );
          handleSocialCredential("facebook", idToken);
        })
        .catch((e) => {
          logFacebookOAuthDiagnostic("oauth_provider_row_aborted", {
            correlationId,
            provider: "facebook",
            apiOAuthWillBeCalled: false,
            errorClass: e instanceof Error ? e.name : "Error",
            ...(isFacebookLoginError(e) ? { failureKind: e.kind } : {}),
          });
          if (isFacebookLoginError(e) && e.kind === "cancelled") {
            setFacebookAttempt((current) =>
              applyFacebookPhaseIfCurrent(current, attemptId, "cancelled"),
            );
            return;
          }
          setFacebookAttempt((current) =>
            applyFacebookPhaseIfCurrent(current, attemptId, "error", "provider_error"),
          );
          toastFacebookLoginError(e);
        })
        .finally(() => {
          setFacebookAttempt((current) => {
            if (current.attemptId !== attemptId) return current;
            if (current.phase === "loading") {
              return applyFacebookPhaseIfCurrent(current, attemptId, "idle");
            }
            if (current.phase === "success") return FACEBOOK_OAUTH_IDLE;
            if (current.phase === "cancelled") return FACEBOOK_OAUTH_IDLE;
            return current;
          });
        });
    } catch (e) {
      setFacebookAttempt((current) =>
        applyFacebookPhaseIfCurrent(current, attemptId, "error", "provider_error"),
      );
      toastFacebookLoginError(e);
    }
  }, [
    disabled,
    interactionBlocked,
    handleSocialCredential,
    providerBusy,
    facebookAttempt,
    showFacebook,
    toastFacebookLoginError,
    facebookWarmState,
    facebookRedirectContext,
    t,
  ]);

  const runProvider = async (provider: "apple" | "facebook") => {
    if (busy) return;
    if (provider === "apple" && !showApple) {
      toastNotConfigured();
      return;
    }
    if (provider === "facebook" && !showFacebook) {
      toastNotConfigured();
      return;
    }
    if (provider === "facebook") {
      runFacebookLogin();
      return;
    }
    setProviderBusy(provider);
    try {
      const idToken = await requestAppleIdToken();
      handleSocialCredential(provider, idToken);
    } catch (e) {
      logClientError(`OAuthProviderRow.${provider}`, e);
      toast.error(toUserFriendlyMessage(e) || t("auth.oauth.providerFailed", { provider }));
    } finally {
      setProviderBusy(null);
    }
  };

  if (!anyProvider) {
    return (
      <p className="text-center text-[11px] text-muted-foreground">
        {t("auth.oauth.envHintBefore")}{" "}
        <code className="rounded bg-muted px-1 text-foreground">VITE_GOOGLE_CLIENT_ID</code>{" "}
        {t("auth.oauth.envHintOr")}{" "}
        <code className="rounded bg-muted px-1 text-foreground">NEXT_PUBLIC_GOOGLE_CLIENT_ID</code>{" "}
        {t("auth.oauth.envHintAfter")}
      </p>
    );
  }

  return (
    <AuthGoogleOAuthScope>
    <>
    <div className={cn("caretip-oauth-circles-wrap", className)}>
    <div
      className={cn(
        "caretip-oauth-circles",
        (busy || interactionBlocked) && "caretip-oauth-circles--disabled",
        interactionBlocked && "pointer-events-none opacity-40",
      )}
      role="group"
      aria-label={ariaLabel ?? t("auth.mobileWebAuth.socialAria")}
      title={interactionBlocked ? blockedTitle ?? t("auth.oauth.signupBlockedTitle") : undefined}
    >
      {WEB_OAUTH_PROVIDER_ORDER.map((provider) => {
        if (provider === "google") {
          if (!showGoogle) return null;
          return (
            <div
              key={provider}
              className={cn(
                "caretip-oauth-google-slot",
                gsiOriginError && "opacity-60",
                (disabled || interactionBlocked) && "caretip-oauth-google-slot--disabled",
              )}
            >
              <AuthGoogleLoginButton onSuccess={onGoogleSuccess} onError={onGoogleError} />
            </div>
          );
        }

        if (provider === "apple") {
          return (
            <OAuthLogoButton
              key={provider}
              provider="apple"
              label={t("auth.oauth.continueWithApple")}
              disabled={busy || (showApple && appleReady === false)}
              loading={providerBusy === "apple"}
              title={
                !showApple
                  ? t("auth.oauth.providerNotConfigured")
                  : appleReady === false
                    ? t("auth.oauth.appleSdkUnavailable")
                    : t("auth.oauth.continueWithApple")
              }
              onClick={() => void runProvider("apple")}
            />
          );
        }

        return (
          <OAuthLogoButton
            key={provider}
            provider="facebook"
            label={t("auth.oauth.continueWithFacebook")}
            disabled={disabled || providerBusy != null || interactionBlocked || facebookLoading}
            loading={facebookLoading}
            title={
              !showFacebook
                ? t("auth.oauth.providerNotConfigured")
                : facebookWarmState === "loading" && !isFacebookSdkReady()
                  ? t("auth.oauth.facebookSdkLoading")
                  : t("auth.oauth.continueWithFacebook")
            }
            onClick={runFacebookLogin}
          />
        );
      })}
    </div>
    <FacebookOAuthInlineStatus
      state={facebookAttempt}
      onRetry={() => {
        resetFacebookAttempt();
        runFacebookLogin();
      }}
      onContinueWithEmail={() => {
        resetFacebookAttempt();
        focusCurrentAuthEmailField();
      }}
    />
    </div>
    </>
    </AuthGoogleOAuthScope>
  );
}
