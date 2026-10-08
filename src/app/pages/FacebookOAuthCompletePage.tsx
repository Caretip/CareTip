import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  clearClientSessionRevoked,
  consumeFacebookOAuthMfaHandoff,
  isMfaLoginChallenge,
  refreshSessionAPI,
} from "@/app/lib/api";
import { useAuth, getPostAuthRedirect } from "@/app/hooks/useAuth";
import { logClientError } from "@/app/lib/clientLog";
import { AuthBootstrapShell } from "@/app/components/auth/AuthBootstrapShell";
import {
  beginAuthSignInHandoff,
  endAuthSignInHandoff,
  markSignInHandoffAuthCompleted,
  markSignInHandoffNavigating,
} from "@/app/lib/authSignInHandoff";
import { beginAuthPostLoginTransition } from "@/app/lib/authPostLoginTransition";
import { preparePostAuthDestination } from "@/app/lib/prefetchAuthenticatedRoutes";
import { REFRESH_COORD_TIMEOUT_MS } from "@/app/lib/authRefreshCoordination";
import { FACEBOOK_OAUTH_START_FAILED_ERROR } from "@/app/lib/facebookOAuthRedirectWeb";
import {
  consumeFacebookOAuthStartFailure,
  logFacebookOAuthStart,
  redactSearchParams,
} from "@/app/lib/facebookOAuthStartObservability";
import { useReleaseAppBootOverlay } from "@/app/context/AppLoadingManager";

const ALLOWED_LINK_RETURN = new Set(["/dashboard/settings", "/employee/settings"]);

type CompletionErrorKind = "query" | "session" | "start";

function resolveLinkReturn(path: string | undefined): string {
  const p = (path ?? "").trim().split("?")[0] ?? "";
  if (ALLOWED_LINK_RETURN.has(p)) return p;
  return "/dashboard/settings";
}

function errorMessageKey(code: string | null): string {
  switch (code) {
    case "cancelled":
      return "auth.oauth.facebookRedirectCancelled";
    case "denied":
      return "auth.oauth.facebookRedirectDenied";
    case "email_required":
      return "auth.oauth.facebookEmailRequired";
    case "email_not_verified":
      return "auth.oauth.facebookEmailNotVerified";
    case "state_invalid":
    case "invalid_callback":
      return "auth.oauth.facebookRedirectStateInvalid";
    case "session_failed":
      return "auth.oauth.facebookRedirectSessionFailed";
    case FACEBOOK_OAUTH_START_FAILED_ERROR:
      return "auth.oauth.facebookRedirectStartFailed";
    default:
      return "auth.oauth.facebookRedirectFailed";
  }
}

function errorTitleKey(kind: CompletionErrorKind, queryCode: string | null): string {
  if (kind === "session") return "auth.oauth.facebookRedirectSessionErrorTitle";
  if (queryCode === FACEBOOK_OAUTH_START_FAILED_ERROR) {
    return "auth.oauth.facebookRedirectStartErrorTitle";
  }
  return "auth.oauth.facebookRedirectErrorTitle";
}

async function refreshSessionWithTimeout(): Promise<Awaited<ReturnType<typeof refreshSessionAPI>>> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error("refresh_timeout"));
      }, REFRESH_COORD_TIMEOUT_MS);
    });
    return await Promise.race([refreshSessionAPI(), timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

export function FacebookOAuthCompletePage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { establishExternalSession } = useAuth();
  const releaseAppBootOverlay = useReleaseAppBootOverlay();

  /** /auth/facebook/complete is not a public-shell path — drop orphan app-boot so error/success UI is visible. */
  useLayoutEffect(() => {
    releaseAppBootOverlay();
  }, [releaseAppBootOverlay]);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<CompletionErrorKind>("query");
  const [queryErrorCode, setQueryErrorCode] = useState<string | null>(null);
  const started = useRef(false);
  const errorHeadingRef = useRef<HTMLHeadingElement>(null);
  const recoveryLinkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (!error) return;
    const focusTarget = errorHeadingRef.current ?? recoveryLinkRef.current;
    focusTarget?.focus();
  }, [error]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    let cancelled = false;

    const err = params.get("error");
    if (err) {
      const priorFailure =
        err === FACEBOOK_OAUTH_START_FAILED_ERROR ? consumeFacebookOAuthStartFailure() : null;
      logFacebookOAuthStart("COMPLETION_ERROR", {
        error: err,
        timestamp: new Date().toISOString(),
        pathname: window.location.pathname,
        search: redactSearchParams(window.location.search),
        ...(priorFailure ? { priorStartFailure: priorFailure } : {}),
      });
      setQueryErrorCode(err);
      setErrorKind(err === FACEBOOK_OAUTH_START_FAILED_ERROR ? "start" : "query");
      setError(t(errorMessageKey(err)));
      return;
    }

    const link = params.get("link");
    if (link === "ok") {
      const dest = resolveLinkReturn(params.get("return") ?? undefined);
      toast.success(t("business.accountSettings.toastOAuthLinked", { provider: "Facebook" }), {
        id: "caretip-fb-link-ok",
      });
      navigate(`${dest}?section=security`, { replace: true });
      return;
    }

    const completion = params.get("completion")?.trim();
    if (completion) {
      beginAuthSignInHandoff();
      void (async () => {
        try {
          const mfa = await consumeFacebookOAuthMfaHandoff(completion);
          if (cancelled) return;
          endAuthSignInHandoff("facebook_redirect_mfa");
          navigate("/login", {
            replace: true,
            state: {
              mfaChallenge: {
                mfaRequired: true,
                mfaSetupRequired: Boolean(mfa.mfaSetupRequired),
                pendingMfaToken: mfa.pendingMfaToken,
              },
            },
          });
        } catch (e) {
          if (cancelled) return;
          logClientError("FacebookOAuthCompletePage.mfa", e);
          endAuthSignInHandoff("facebook_redirect_mfa_failed");
          setErrorKind("query");
          setError(t("auth.oauth.facebookRedirectFailed"));
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    if (params.get("success") !== "1") {
      setErrorKind("query");
      setError(t("auth.oauth.facebookRedirectFailed"));
      return;
    }

    beginAuthSignInHandoff();
    clearClientSessionRevoked();
    void (async () => {
      try {
        const data = await refreshSessionWithTimeout();
        if (cancelled) return;
        if (isMfaLoginChallenge(data)) {
          endAuthSignInHandoff("facebook_redirect_mfa_refresh");
          navigate("/login", { replace: true, state: { mfaChallenge: data } });
          return;
        }
        const user = establishExternalSession(data);
        const target = getPostAuthRedirect(user);
        markSignInHandoffAuthCompleted();
        try {
          await preparePostAuthDestination(target);
        } catch {
          /* navigate anyway */
        }
        flushSync(() => {
          markSignInHandoffNavigating(target);
          beginAuthPostLoginTransition(target);
        });
        navigate(target, { replace: true });
      } catch (e) {
        if (cancelled) return;
        logClientError("FacebookOAuthCompletePage.session", e);
        endAuthSignInHandoff("facebook_redirect_session_failed");
        setErrorKind("session");
        setError(t("auth.oauth.facebookRedirectSessionFailed"));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [params, navigate, t, establishExternalSession]);

  if (error) {
    const showTryAgain = queryErrorCode === FACEBOOK_OAUTH_START_FAILED_ERROR;
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="max-w-md text-center space-y-4">
          <h1
            ref={errorHeadingRef}
            tabIndex={-1}
            className="text-2xl font-semibold text-foreground outline-none"
          >
            {t(errorTitleKey(errorKind, queryErrorCode))}
          </h1>
          <p className="text-muted-foreground" role="alert" aria-live="assertive">
            {error}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            {showTryAgain ? (
              <Link
                to="/login"
                className="inline-block px-5 py-2.5 rounded-lg border border-border text-foreground"
              >
                {t("auth.oauth.facebookRedirectTryAgain")}
              </Link>
            ) : null}
            <Link
              ref={recoveryLinkRef}
              to="/login"
              className="inline-block px-5 py-2.5 rounded-lg bg-primary text-primary-foreground"
            >
              {t("auth.oauth.facebookRedirectBackToSignIn")}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return <AuthBootstrapShell />;
}
