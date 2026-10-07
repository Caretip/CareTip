import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { consumeFacebookOAuthMfaHandoff, isMfaLoginChallenge, refreshSessionAPI } from "@/app/lib/api";
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

const ALLOWED_LINK_RETURN = new Set(["/dashboard/settings", "/employee/settings"]);

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
    default:
      return "auth.oauth.facebookRedirectFailed";
  }
}

export function FacebookOAuthCompletePage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { establishExternalSession } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const err = params.get("error");
    if (err) {
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
          logClientError("FacebookOAuthCompletePage.mfa", e);
          setError(t("auth.oauth.facebookRedirectFailed"));
        }
      })();
      return;
    }

    if (params.get("success") !== "1") {
      setError(t("auth.oauth.facebookRedirectFailed"));
      return;
    }

    beginAuthSignInHandoff();
    void (async () => {
      try {
        const data = await refreshSessionAPI();
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
        logClientError("FacebookOAuthCompletePage.session", e);
        endAuthSignInHandoff("facebook_redirect_session_failed");
        setError(t("auth.oauth.facebookRedirectFailed"));
      }
    })();
  }, [params, navigate, t, establishExternalSession]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-2xl font-semibold text-foreground">{t("auth.oauth.facebookRedirectErrorTitle")}</h1>
          <p className="text-muted-foreground">{error}</p>
          <Link
            to="/login"
            className="inline-block px-5 py-2.5 rounded-lg bg-primary text-primary-foreground"
          >
            {t("auth.oauth.facebookRedirectBackToSignIn")}
          </Link>
        </div>
      </div>
    );
  }

  return <AuthBootstrapShell />;
}
