import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  createConnectAccountLink,
  getConnectStatus,
  type ConnectStatus,
} from "../../../../lib/api";
import { toUserFriendlyMessage } from "../../../../lib/errorMessages";
import {
  APP_LOADING_PRIORITY,
  useAppLoadingRegistration,
} from "../../../../lib/globalAppLoading";
import { performExternalStripeRedirect } from "../../../../lib/externalStripeRedirect";
import { cn } from "@/lib/utils";

function statusHeadlineKey(status: ConnectStatus["status"]): string {
  switch (status) {
    case "ready":
      return "business.billing.connect.statusReady";
    case "requires_information":
    case "restricted":
      return "business.billing.connect.statusAttention";
    case "onboarding_incomplete":
    case "onboarding_required":
      return "business.billing.connect.statusIncomplete";
    default:
      return "business.billing.connect.statusNotConnected";
  }
}

function ctaLabelKey(status: ConnectStatus["status"]): string {
  switch (status) {
    case "ready":
      return "business.billing.connect.manage";
    case "requires_information":
    case "restricted":
    case "onboarding_incomplete":
    case "onboarding_required":
      return "business.billing.connect.continue";
    default:
      return "business.billing.connect.connect";
  }
}

/**
 * Minimal Stripe Connect Express onboarding panel.
 * Page header carries “Stripe / Connect Stripe…”. This panel is status + action only.
 */
export function BusinessStripeConnectCard() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<ConnectStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useAppLoadingRegistration(
    "stripe-connect-onboarding",
    APP_LOADING_PRIORITY.APP_INIT,
    busy,
    t("common.loading.checkout"),
  );

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const status = await getConnectStatus();
      setData(status);
    } catch (err) {
      setError(toUserFriendlyMessage(err) || t("business.billing.connect.loadError"));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const connect = searchParams.get("connect");
    if (connect !== "return" && connect !== "refresh") return;
    void reload().then(() => {
      if (connect === "refresh") {
        toast.message(t("business.billing.connect.linkExpired"));
      } else {
        toast.message(t("business.billing.connect.returnedHint"));
      }
    });
    const next = new URLSearchParams(searchParams);
    next.delete("connect");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, reload, t]);

  async function startOnboarding() {
    setBusy(true);
    try {
      const { url } = await createConnectAccountLink();
      const redirect = performExternalStripeRedirect(url, "connect");
      if (!redirect.ok) {
        toast.error(t("business.billing.connect.startError"));
        setBusy(false);
      }
    } catch (err) {
      toast.error(toUserFriendlyMessage(err) || t("business.billing.connect.startError"));
      setBusy(false);
    }
  }

  if (loading && !data) {
    return (
      <div className="flex min-h-[80px] items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        <span>{t("business.billing.connect.loading")}</span>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div
        className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200"
        role="alert"
      >
        <p>{error}</p>
        <button
          type="button"
          onClick={() => void reload()}
          className="mt-2 font-semibold underline underline-offset-2"
        >
          {t("business.billing.retry")}
        </button>
      </div>
    );
  }

  if (!data) return null;

  const canStart = data.stripeConfigured;
  const isReady = data.status === "ready";
  const statusKey = statusHeadlineKey(data.status);

  return (
    <section
      className="stripe-connect-card max-lg:space-y-4 lg:rounded-xl lg:border lg:border-border/80 lg:bg-card lg:px-5 lg:py-5"
      aria-labelledby="stripe-connect-status"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <p
            id="stripe-connect-status"
            className="text-base font-semibold tracking-tight text-foreground"
            data-connect-status={data.status}
            data-connect-readiness={isReady ? "ready" : "required"}
          >
            {t(statusKey)}
          </p>
          {!data.stripeConfigured ? (
            <p className="text-sm text-muted-foreground">{t("business.billing.connect.notConfigured")}</p>
          ) : null}
          {!isReady && data.stripeConfigured ? (
            <p className="text-sm text-muted-foreground">{t("business.billing.connect.nextStepHint")}</p>
          ) : null}
          <p className="text-sm">
            <Link
              to="/dashboard/stripe/payouts"
              className="font-medium text-[#197278] underline underline-offset-2 hover:text-[#145c61]"
            >
              {t("business.billing.connect.viewPayouts")}
            </Link>
          </p>
        </div>
        <div className="shrink-0">
          <button
            type="button"
            disabled={!canStart || busy}
            onClick={() => void startOnboarding()}
            className={cn(
              "inline-flex h-11 w-full items-center justify-center rounded-lg px-4 text-sm font-semibold transition sm:w-auto",
              "bg-[#197278] text-white hover:bg-[#145c61] disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {busy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                {t("business.billing.connect.starting")}
              </>
            ) : (
              t(ctaLabelKey(data.status))
            )}
          </button>
        </div>
      </div>
    </section>
  );
}
