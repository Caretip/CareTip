import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { consumeMobileWebHandoff } from "@/app/lib/api";
import { useAuth } from "@/app/hooks/useAuth";
import { logClientError } from "@/app/lib/clientLog";
import { AuthBootstrapShell } from "@/app/components/auth/AuthBootstrapShell";
import { markMobileBillingHandoffBanner } from "@/app/components/business/billing/MobileBillingHandoffBanner";

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
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { establishExternalSession } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const token = (params.get("token") ?? "").trim();
    if (!token) {
      setError("This sign-in link is missing or incomplete. Return to the CareTip app and open Billing again.");
      return;
    }

    void (async () => {
      try {
        const session = await consumeMobileWebHandoff(token);
        establishExternalSession(session);
        markMobileBillingHandoffBanner();
        navigate(resolveDestination(session.destinationPath), { replace: true });
      } catch (err) {
        logClientError("MobileAuthHandoffPage", err);
        const msg =
          err instanceof Error && err.message.trim()
            ? err.message.trim()
            : "This sign-in link is invalid or has expired. Return to the CareTip app and open Billing again.";
        setError(msg);
      }
    })();
  }, [params, establishExternalSession, navigate]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-2xl font-semibold text-foreground">Couldn’t open Billing</h1>
          <p className="text-muted-foreground">{error}</p>
          <Link
            to="/login"
            className="inline-block px-5 py-2.5 rounded-lg bg-primary text-primary-foreground"
          >
            Sign in on the web
          </Link>
        </div>
      </div>
    );
  }

  return <AuthBootstrapShell />;
}
