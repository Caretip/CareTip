import { useCallback, useEffect, useState, type ReactNode } from "react";
import { GoogleLogin, type CredentialResponse } from "@react-oauth/google";
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
import { requestFacebookAccessToken } from "@/app/lib/facebookOAuthWeb";
import { logClientError } from "@/app/lib/clientLog";
import { toUserFriendlyMessage } from "@/app/lib/errorMessages";
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
}: OAuthProviderRowProps) {
  const { t } = useTranslation();
  const googleClientId = googleOAuthWebClientId();
  const appleClientId = appleOAuthWebClientId();
  const facebookAppId = facebookOAuthWebAppId();
  const [gsiOriginError, setGsiOriginError] = useState(false);
  const [appleReady, setAppleReady] = useState<boolean | null>(null);
  const [providerBusy, setProviderBusy] = useState<OAuthProviderId | null>(null);

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
    setProviderBusy(provider);
    try {
      const idToken =
        provider === "apple" ? await requestAppleIdToken() : await requestFacebookAccessToken();
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
                  className="caretip-oauth-circle__logo"
                  draggable={false}
                />
              )}
              {showGoogle ? (
                <div className="caretip-oauth-circle__gsi" aria-hidden>
                  <GoogleLogin
                    onSuccess={onGoogleSuccess}
                    onError={onGoogleError}
                    useOneTap={false}
                    type="icon"
                    shape="circle"
                    theme="outline"
                    size="large"
                    text="continue_with"
                    containerProps={{
                      className: "caretip-oauth-gsi-host",
                      style: { width: 44, height: 44 },
                    }}
                  />
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
            disabled={busy}
            loading={providerBusy === "facebook"}
            title={
              !showFacebook
                ? t("auth.oauth.providerNotConfigured")
                : t("auth.oauth.continueWithFacebook")
            }
            onClick={() => void runProvider("facebook")}
          />
        );
      })}
    </div>
  );
}
