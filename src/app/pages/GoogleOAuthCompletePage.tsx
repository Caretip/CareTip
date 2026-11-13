import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { AuthOAuthProgress } from "@/app/components/auth/AuthOAuthProgress";
import { useReleaseAppBootOverlay } from "@/app/context/AppLoadingManager";
import {
  parseGoogleRedirectFragment,
  readGoogleRedirectIntent,
  resolveGoogleRedirectReturnPath,
  storeGoogleRedirectHandoff,
  takeGoogleRedirectHandoff,
} from "@/app/lib/googleOAuthRedirectWeb";
import { ensureAuthEntryRouteCode } from "@/app/routing/routeLazy";

const KNOWN_ERRORS = new Set(["csrf", "missing_credential", "rejected", "unavailable", "rate_limited"]);

/**
 * Landing page for Google redirect-mode sign-in (mobile web). Never blank: it either forwards the
 * sealed credential to the auth page (which finishes sign-in with the normal rules and errors) or
 * shows a recoverable error with "Try again" and "Sign in with email".
 */
export function GoogleOAuthCompletePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const releaseAppBootOverlay = useReleaseAppBootOverlay();
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const started = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const intent = readGoogleRedirectIntent();
  const returnPath = resolveGoogleRedirectReturnPath(intent);

  // This page draws its own state (Google progress or the error screen), so no CareTip loader is
  // needed on top of it. The boot screen on this URL already shows the same Google progress
  // (public/boot-locale.js), so the hand-over is seamless.
  useLayoutEffect(() => {
    releaseAppBootOverlay();
  }, [releaseAppBootOverlay]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const { handoff, error } = parseGoogleRedirectFragment(window.location.hash);
    // The fragment carries a credential: drop it from the address bar and history immediately.
    window.history.replaceState(window.history.state, "", window.location.pathname);
    if (handoff) {
      storeGoogleRedirectHandoff(handoff);
      // Navigate once the auth page's code is here, so it renders straight away (no Suspense loader).
      const codeReady = ensureAuthEntryRouteCode(returnPath);
      if (!codeReady) navigate(returnPath, { replace: true });
      else void codeReady.then(() => navigate(returnPath, { replace: true }));
      return;
    }
    // Refresh / back to this page without a fragment: never leave a stale credential behind.
    takeGoogleRedirectHandoff();
    setErrorCode(error && KNOWN_ERRORS.has(error) ? error : "generic");
  }, [navigate, returnPath]);

  useEffect(() => {
    if (errorCode) headingRef.current?.focus();
  }, [errorCode]);

  if (!errorCode) {
    // Same "Signing you in with Google" state as the boot screen before it and the auth page after it.
    return (
      <div data-caretip-route-ready="">
        <AuthOAuthProgress provider="google" />
      </div>
    );
  }

  return (
    <div data-caretip-route-ready="" className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md space-y-4 text-center">
        <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold text-foreground outline-none">
          {t("auth.oauth.googleRedirect.title")}
        </h1>
        <p className="text-muted-foreground" role="alert" aria-live="assertive">
          {t(`auth.oauth.googleRedirect.error_${errorCode}`)}
        </p>
        <div className="flex flex-col justify-center gap-3 sm:flex-row">
          <Link
            to={returnPath}
            replace
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-5 py-2.5 font-semibold text-primary-foreground"
          >
            {t("auth.oauth.googleRedirect.tryAgain")}
          </Link>
          <Link
            to={intent?.isLogin === false ? "/signup" : "/login"}
            replace
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-5 py-2.5 text-foreground"
          >
            {t("auth.oauth.googleRedirect.useEmail")}
          </Link>
        </div>
      </div>
    </div>
  );
}
