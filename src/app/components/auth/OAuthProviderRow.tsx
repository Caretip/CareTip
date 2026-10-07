import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { CredentialResponse } from "@react-oauth/google";
import { AuthGoogleLoginCircle } from "@/app/components/auth/AuthGoogleLoginCircle";
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
import "@/styles/caretip-oauth-circles.css";

/** Desktop / mobile-web order: Google → Facebook → Apple. */
export const WEB_OAUTH_PROVIDER_ORDER: readonly OAuthProviderId[] = [
  "google",
  "facebook",
  "apple",
] as const;

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

  useEffect(() => {
    registerFacebookOrphanedTokenHandler((token, meta) => {
      logFacebookOAuthDiagnostic("oauth_orphan_token_recovery", {
        provider: "facebook",
        correlationId: meta.correlationId,
        loginInvocation: meta.loginInvocation,
        apiOAuthWillBeCalled: true,
      });
      onSocialCredential("facebook", token);
    });
    return () => registerFacebookOrphanedTokenHandler(null);
  }, [onSocialCredential]);

  useEffect(() => {
    if (providerBusy !== "facebook") return;
    const safetyMs = 150_000;
    const timer = window.setTimeout(() => {
      logFacebookOAuthDiagnostic("oauth_provider_busy_safety_reset", {
        provider: "facebook",
        elapsedMs: safetyMs,
      });
      setProviderBusy(null);
    }, safetyMs);
    return () => window.clearTimeout(timer);
  }, [providerBusy]);

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

  const onGoogleSuccess = useCallback(
    (cred: CredentialResponse) => {
      setGsiOriginError(false);
      if (cred.credential) onSocialCredential("google", cred.credential);
    },
    [onSocialCredential],
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
  const anyProvider = showGoogle || showApple || showFacebook;

  const interactionBlocked = !allowInteraction;
  const busy = disabled || providerBusy != null || interactionBlocked;

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
    if (providerBusy != null) {
      logFacebookOAuthDiagnostic("oauth_row_click_ignored", {
        provider: "facebook",
        reason: "provider_busy",
        providerBusy,
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
      setProviderBusy("facebook");
      submitFacebookOAuthRedirectStart(
        { ...facebookRedirectContext, correlationId },
        "/api/auth/facebook/start",
      );
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
    setProviderBusy("facebook");
    try {
      const tokenPromise = requestFacebookAccessToken(clickContext, correlationId);
      void tokenPromise
        .then((idToken) => {
          onSocialCredential("facebook", idToken);
        })
        .catch((e) => {
          logFacebookOAuthDiagnostic("oauth_provider_row_aborted", {
            correlationId,
            provider: "facebook",
            apiOAuthWillBeCalled: false,
            errorClass: e instanceof Error ? e.name : "Error",
            ...(isFacebookLoginError(e) ? { failureKind: e.kind } : {}),
          });
          toastFacebookLoginError(e);
        })
        .finally(() => {
          setProviderBusy(null);
        });
    } catch (e) {
      setProviderBusy(null);
      toastFacebookLoginError(e);
    }
  }, [
    disabled,
    interactionBlocked,
    onSocialCredential,
    providerBusy,
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
      onSocialCredential(provider, idToken);
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
    <div
      className={cn(
        "caretip-oauth-circles",
        (busy || interactionBlocked) && "caretip-oauth-circles--disabled",
        interactionBlocked && "pointer-events-none opacity-40",
        className,
      )}
      role="group"
      aria-label={ariaLabel ?? t("auth.mobileWebAuth.socialAria")}
      title={interactionBlocked ? blockedTitle ?? t("auth.oauth.signupBlockedTitle") : undefined}
    >
      {WEB_OAUTH_PROVIDER_ORDER.map((provider) => {
        if (provider === "google") {
          const label = t("auth.oauth.continueWithGoogle");
          return (
            <div
              key={provider}
              className={cn(
                "caretip-oauth-circle caretip-oauth-circle--asset caretip-oauth-circle--google",
                gsiOriginError && "opacity-60",
                (disabled || interactionBlocked) && "caretip-oauth-circle--disabled",
                !showGoogle && "caretip-oauth-circle--unconfigured",
              )}
              aria-label={label}
              title={label}
              role={showGoogle ? undefined : "button"}
              tabIndex={showGoogle ? undefined : 0}
              onClick={
                showGoogle
                  ? undefined
                  : () => {
                      if (!busy) toastNotConfigured();
                    }
              }
              onKeyDown={
                showGoogle
                  ? undefined
                  : (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        if (!busy) toastNotConfigured();
                      }
                    }
              }
            >
              {providerBusy === "google" ? (
                <span className="caretip-oauth-circle__spinner" aria-hidden />
              ) : (
                <img
                  src={OAUTH_LOGO_SRC.google}
                  alt=""
                  aria-hidden
                  width={44}
                  height={44}
                  decoding="async"
                  className="caretip-oauth-circle__logo"
                  draggable={false}
                />
              )}
              {showGoogle ? (
                <div className="caretip-oauth-circle__gsi" aria-hidden>
                  <AuthGoogleLoginCircle onSuccess={onGoogleSuccess} onError={onGoogleError} />
                </div>
              ) : null}
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
            disabled={disabled || providerBusy != null || interactionBlocked}
            loading={
              providerBusy === "facebook" ||
              (showFacebook &&
                facebookWarmState === "loading" &&
                providerBusy == null &&
                isFacebookSdkReady())
            }
            title={
              !showFacebook
                ? t("auth.oauth.providerNotConfigured")
                : facebookWarmState === "loading"
                  ? t("auth.oauth.facebookSdkLoading")
                  : t("auth.oauth.continueWithFacebook")
            }
            onClick={runFacebookLogin}
          />
        );
      })}
    </div>
    </AuthGoogleOAuthScope>
  );
}
