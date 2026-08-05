import { useCallback, useEffect, useRef, useState } from "react";
import { GoogleLogin } from "@react-oauth/google";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { googleOAuthWebClientId } from "@/app/lib/googleOAuthWebClientId";
import { cn } from "@/lib/utils";

type SocialLoginRowProps = {
  disabled?: boolean;
  isLogin?: boolean;
  onGoogleCredential: (idToken: string) => void;
};

function GoogleGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#EA4335"
        d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.9-5.5 3.9-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.9 3.3 14.7 2.3 12 2.3 6.9 2.3 2.8 6.4 2.8 11.5S6.9 20.7 12 20.7c5.2 0 8.6-3.6 8.6-8.7 0-.6-.1-1-.2-1.5H12Z"
      />
      <path
        fill="#34A853"
        d="M3.9 7.4 7.1 9.8C8 7.7 9.9 6.2 12 6.2c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.9 3.3 14.7 2.3 12 2.3 8.2 2.3 4.9 4.5 3.9 7.4Z"
      />
      <path
        fill="#FBBC05"
        d="M12 20.7c2.6 0 4.8-.9 6.4-2.4l-3.1-2.4c-.9.6-2 1-3.3 1-2.5 0-4.6-1.7-5.4-4l-3.2 2.5c1.5 3 4.5 5.3 8.6 5.3Z"
      />
      <path
        fill="#4285F4"
        d="M20.6 11.5c0-.6-.1-1-.2-1.5H12v3.9h5.5c-.3 1.3-1.1 2.3-2.2 3l3.1 2.4c1.8-1.7 3.2-4.2 3.2-7.8Z"
      />
    </svg>
  );
}

export function SocialLoginRow({
  disabled = false,
  isLogin = true,
  onGoogleCredential,
}: SocialLoginRowProps) {
  const { t } = useTranslation();
  const googleClientId = googleOAuthWebClientId();
  const [gsiMounted, setGsiMounted] = useState(false);
  const [buttonWidth, setButtonWidth] = useState(320);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setGsiMounted(true);
  }, []);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const syncWidth = () => {
      const w = el.getBoundingClientRect().width;
      setButtonWidth(Math.min(400, Math.max(240, Math.floor(w))));
    };
    const ro = new ResizeObserver(syncWidth);
    ro.observe(el);
    syncWidth();
    return () => ro.disconnect();
  }, []);

  const onGoogleError = useCallback(() => {
    toast.error(
      t("auth.oauth.googleOriginError", {
        origin: typeof window !== "undefined" ? window.location.origin : "",
      }),
    );
  }, [t]);

  if (!googleClientId?.trim()) {
    return (
      <p className="mw-auth-google-missing">
        {t("auth.oauth.envHintBefore")}{" "}
        <code>VITE_GOOGLE_CLIENT_ID</code>
      </p>
    );
  }

  return (
    <div
      ref={hostRef}
      className={cn("mw-auth-google", disabled && "mw-auth-google--disabled")}
      aria-label={t("auth.mobileWebAuth.socialAria")}
    >
      <div className="mw-auth-google__face" aria-hidden>
        <GoogleGlyph />
        <span>
          {isLogin
            ? t("auth.mobileWebAuth.continueWithGoogle")
            : t("auth.mobileWebAuth.signUpWithGoogle")}
        </span>
      </div>
      {gsiMounted ? (
        <div className="mw-auth-google__gsi">
          <GoogleLogin
            key={buttonWidth}
            onSuccess={(res) => {
              if (res.credential) onGoogleCredential(res.credential);
            }}
            onError={onGoogleError}
            useOneTap={false}
            theme="outline"
            size="large"
            width={buttonWidth}
            logo_alignment="left"
            text={isLogin ? "continue_with" : "signup_with"}
            shape="pill"
          />
        </div>
      ) : null}
    </div>
  );
}
