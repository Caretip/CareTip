import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { GoogleLogin, useGoogleOAuth, type CredentialResponse } from "@react-oauth/google";
import type { GoogleOAuthUxMode } from "@/app/lib/googleOAuthRedirectWeb";
import { hasGoogleGsiScriptFailed, subscribeGoogleGsiScriptStatus } from "@/app/lib/googleGsiScriptStatus";

type AuthGoogleLoginButtonProps = {
  onSuccess: (cred: CredentialResponse) => void;
  onError: () => void;
  /** popup (desktop default) or redirect (mobile web, no second tab). */
  uxMode?: GoogleOAuthUxMode;
  loginUri?: string;
  /** Popup mode: user came back to this tab and no credential arrived (closed / blank Google tab). */
  onPopupStalled?: () => void;
  /** Fired when the user activates the button (popup or redirect). */
  onActivate?: () => void;
};

/** GIS only accepts a pixel width between 200 and 400. */
const GSI_MIN_WIDTH = 200;
const GSI_MAX_WIDTH = 400;
const GSI_BUTTON_HEIGHT = 40;
/** After returning to this tab, wait this long for the popup credential before offering recovery. */
const POPUP_STALL_GRACE_MS = 4000;

function clampGsiWidth(px: number): number {
  return Math.round(Math.min(GSI_MAX_WIDTH, Math.max(GSI_MIN_WIDTH, px)));
}

/**
 * Official GIS "Continue with Google" button, sized to the auth form width.
 * Mounts only after gsi/client loads — avoids renderButton races on undefined containers.
 */
export function AuthGoogleLoginButton({
  onSuccess,
  onError,
  uxMode = "popup",
  loginUri,
  onPopupStalled,
  onActivate,
}: AuthGoogleLoginButtonProps) {
  const { t } = useTranslation();
  const { scriptLoadedSuccessfully } = useGoogleOAuth();
  const scriptFailed = useSyncExternalStore(subscribeGoogleGsiScriptStatus, hasGoogleGsiScriptFailed, () => false);
  const hostRef = useRef<HTMLDivElement>(null);
  /**
   * Measured before paint; the Google button renders only once the width is known. It used to render
   * at 200px and redraw at the real width, visibly rebuilding Google's iframe on every mount.
   */
  const [width, setWidth] = useState<number | null>(null);
  /** Redirect mode: tapped, the browser is about to leave for Google. */
  const [leavingForGoogle, setLeavingForGoogle] = useState(false);
  const attemptRef = useRef(false);
  /** Safari does not move focus into the button iframe; pointer position is the fallback signal. */
  const pointerOverRef = useRef(false);
  const stallTimerRef = useRef<number | null>(null);
  const callbacksRef = useRef({ onPopupStalled, onActivate });
  callbacksRef.current = { onPopupStalled, onActivate };

  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const measure = () => {
      const next = clampGsiWidth(el.getBoundingClientRect().width);
      setWidth((prev) => (prev === next ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The GIS button is a cross-origin iframe, so clicks are observed indirectly: focus moves into the
  // iframe (window blur). If the user later comes back to this tab without a credential arriving,
  // the popup was closed or got stuck — offer a retry instead of leaving them guessing.
  useEffect(() => {
    const clearStall = () => {
      if (stallTimerRef.current != null) window.clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
    };
    const onBlur = () => {
      window.setTimeout(() => {
        const active = document.activeElement;
        const focusedButton = active instanceof HTMLIFrameElement && hostRef.current?.contains(active);
        if (focusedButton || pointerOverRef.current) {
          attemptRef.current = true;
          clearStall();
          if (uxMode === "redirect") setLeavingForGoogle(true);
          callbacksRef.current.onActivate?.();
        }
      }, 0);
    };
    const onReturn = () => {
      // Back on this page (Back from Google, bfcache restore, focus): no longer leaving.
      if (document.visibilityState !== "hidden") setLeavingForGoogle(false);
      if (!attemptRef.current || uxMode !== "popup") return;
      if (document.visibilityState === "hidden") return;
      clearStall();
      stallTimerRef.current = window.setTimeout(() => {
        if (attemptRef.current) {
          attemptRef.current = false;
          callbacksRef.current.onPopupStalled?.();
        }
      }, POPUP_STALL_GRACE_MS);
    };
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onReturn);
    window.addEventListener("pageshow", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      clearStall();
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onReturn);
      window.removeEventListener("pageshow", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [uxMode]);

  const handleSuccess = (cred: CredentialResponse) => {
    attemptRef.current = false;
    if (stallTimerRef.current != null) window.clearTimeout(stallTimerRef.current);
    onSuccess(cred);
  };

  const handleError = () => {
    attemptRef.current = false;
    if (stallTimerRef.current != null) window.clearTimeout(stallTimerRef.current);
    onError();
  };

  const redirect = uxMode === "redirect" && Boolean(loginUri);

  return (
    <div
      ref={hostRef}
      className="caretip-oauth-google-button relative"
      onPointerEnter={() => {
        pointerOverRef.current = true;
      }}
      onPointerLeave={() => {
        pointerOverRef.current = false;
      }}
    >
      {scriptLoadedSuccessfully && width != null ? (
        <GoogleLogin
          onSuccess={handleSuccess}
          onError={handleError}
          useOneTap={false}
          type="standard"
          theme="outline"
          size="large"
          text="continue_with"
          shape="rectangular"
          logo_alignment="center"
          width={width}
          {...(redirect ? { ux_mode: "redirect" as const, login_uri: loginUri } : {})}
          containerProps={{
            className: "caretip-oauth-gsi-host",
            style: { width, minHeight: GSI_BUTTON_HEIGHT },
          }}
        />
      ) : scriptFailed ? (
        // The Google script was blocked or failed: say so instead of showing an empty, dead box.
        <p className="caretip-oauth-google-button__unavailable" role="note">
          {t("auth.oauth.googleUnavailable")}
        </p>
      ) : (
        <div
          className="caretip-oauth-google-button__placeholder"
          style={{ width: width ?? "100%", maxWidth: GSI_MAX_WIDTH, height: GSI_BUTTON_HEIGHT }}
          aria-hidden
        />
      )}
      {leavingForGoogle ? (
        <div
          className="absolute inset-0 z-[1] flex items-center justify-center gap-2 rounded-md bg-background/90 text-sm font-medium text-foreground"
          role="status"
          aria-live="polite"
          data-google-leaving=""
        >
          <span
            className="h-4 w-4 animate-spin rounded-full border-2 border-primary/25 border-t-primary motion-reduce:animate-none"
            aria-hidden
          />
          {t("auth.oauth.openingGoogle")}
        </div>
      ) : null}
    </div>
  );
}
