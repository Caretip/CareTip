import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { consumeMobileWebHandoff } from "@/app/lib/api";
import { useAuth } from "@/app/hooks/useAuth";
import { logClientError } from "@/app/lib/clientLog";
import { AuthBootstrapShell } from "@/app/components/auth/AuthBootstrapShell";
import { markMobileBillingHandoffBanner } from "@/app/components/business/billing/MobileBillingHandoffBanner";
import {
  beginAuthSignInHandoff,
  endAuthSignInHandoff,
  markSignInHandoffAuthCompleted,
  markSignInHandoffNavigating,
} from "@/app/lib/authSignInHandoff";
import { beginAuthPostLoginTransition } from "@/app/lib/authPostLoginTransition";
import { preparePostAuthDestination } from "@/app/lib/prefetchAuthenticatedRoutes";
import { applyMobileWebHandoffLocaleFromSearch } from "@/app/lib/mobileWebHandoffLocale";

const ALLOWED_DESTINATIONS = new Set([
  "/dashboard/billing/subscription",
  "/dashboard/billing/invoices",
  "/dashboard/billing/payment-methods",
  "/dashboard/billing/plan",
]);

function resolveDestination(path: string | undefined): string {
  const trimmed = (path ?? "").trim();
  if (ALLOWED_DESTINATIONS.has(trimmed)) return trimmed;
  return "/dashboard/billing/subscription";
}

/**
 * Mobile → web authentication bridge.
 * Validates a one-time handoff token, establishes a normal web session
 * (HttpOnly refresh cookie + in-memory access JWT), then redirects to billing.
 * Never shows password / Google login UI on the success path.
 */
export function MobileAuthHandoffPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { establishExternalSession } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    beginAuthSignInHandoff();
    void applyMobileWebHandoffLocaleFromSearch(params);

    const token = (params.get("token") ?? "").trim();
    if (!token) {
      endAuthSignInHandoff("mobile_handoff_missing_token");
      setError(t("mobileWebHandoff.errorMissingToken"));
      return;
    }

    void (async () => {
      try {
        const session = await consumeMobileWebHandoff(token);
        const destination = resolveDestination(session.destinationPath);
        establishExternalSession(session);
        markMobileBillingHandoffBanner();
        markSignInHandoffAuthCompleted();
        try {
          await preparePostAuthDestination(destination);
        } catch {
          /* Still navigate — cover stays until layout shell commits. */
        }
        flushSync(() => {
          markSignInHandoffNavigating(destination);
          beginAuthPostLoginTransition(destination);
        });
        navigate(destination, { replace: true });
      } catch (err) {
        logClientError("MobileAuthHandoffPage", err);
        endAuthSignInHandoff("mobile_handoff_consume_failed");
        setError(t("mobileWebHandoff.errorInvalid"));
      }
    })();
  }, [params, establishExternalSession, navigate, t]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-2xl font-semibold text-foreground">{t("mobileWebHandoff.errorTitle")}</h1>
          <p className="text-muted-foreground">{error}</p>
          <Link
            to="/login"
            className="inline-block px-5 py-2.5 rounded-lg bg-primary text-primary-foreground"
          >
            {t("mobileWebHandoff.signInWeb")}
          </Link>
        </div>
      </div>
    );
  }

  return <AuthBootstrapShell tagline={t("common.loading.sessionCheck")} />;
}
