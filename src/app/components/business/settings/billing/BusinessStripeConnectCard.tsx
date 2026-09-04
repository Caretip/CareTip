import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createConnectAccountLink, type ConnectStatus } from "../../../../lib/api";
import { fetchConnectStatusCached } from "../../../../lib/stripeConnectStatusCache";
import {
  stripeConnectCtaKey,
  stripeConnectHeadlineKey,
  stripeConnectTrafficLight,
} from "../../../../lib/stripeConnectPresentation";
import { formatBerlinDateTime } from "../../../../lib/physicalQrOrderUi";
import { toUserFriendlyMessage } from "../../../../lib/errorMessages";
import {
  APP_LOADING_PRIORITY,
  useAppLoadingRegistration,
} from "../../../../lib/globalAppLoading";
import { performExternalStripeRedirect } from "../../../../lib/externalStripeRedirect";
import { useRequireAuth } from "../../../../hooks/useRequireAuth";
import { cn } from "@/lib/utils";

function statusToneClass(light: ReturnType<typeof stripeConnectTrafficLight>): string {
  if (light === "green") {
    return "border-l-emerald-600 bg-emerald-50/80 text-emerald-950 dark:border-l-emerald-500 dark:bg-emerald-950/25 dark:text-emerald-50";
  }
  if (light === "yellow") {
    return "border-l-amber-500 bg-amber-50/80 text-amber-950 dark:border-l-amber-400 dark:bg-amber-950/25 dark:text-amber-50";
  }
  return "border-l-red-600 bg-red-50/80 text-red-950 dark:border-l-red-500 dark:bg-red-950/30 dark:text-red-50";
}

/**
 * Stripe Connect Express status — traffic-light presentation of backend ConnectStatus.
 */
export function BusinessStripeConnectCard() {
  const { t, i18n } = useTranslation();
  const { user } = useRequireAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<ConnectStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const venueName =
    user?.businessName?.trim() || user?.name?.trim() || "";

  useAppLoadingRegistration(
    "stripe-connect-onboarding",
    APP_LOADING_PRIORITY.APP_INIT,
    busy,
    t("common.loading.checkout"),
  );

  const reload = useCallback(async (revalidate = false) => {
    setLoading(true);
    setError(null);
    try {
      const status = await fetchConnectStatusCached({ revalidate });
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
    void reload(true).then(() => {
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
        className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200"
        role="alert"
      >
        <p>{error}</p>
        <button
          type="button"
          onClick={() => void reload(true)}
          className="mt-2 font-semibold underline underline-offset-2"
        >
          {t("business.billing.retry")}
        </button>
      </div>
    );
  }

  if (!data) return null;

  const canStart = data.stripeConfigured;
  const light = stripeConnectTrafficLight(data);
  const ctaKey = stripeConnectCtaKey(data);
  const statusLabel = t(stripeConnectHeadlineKey(data));
  const lastSync =
    data.updatedAt && data.updatedAt.trim()
      ? formatBerlinDateTime(data.updatedAt, i18n.language)
      : null;

  return (
    <section className="stripe-connect-card space-y-5" aria-labelledby="stripe-connect-status">
      <div
        className={cn(
          "border-l-[3px] px-4 py-3 sm:px-5 sm:py-4",
          statusToneClass(light),
        )}
        role="status"
        aria-live="polite"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1.5">
            <p
              id="stripe-connect-status"
              className="text-base font-semibold tracking-tight"
              data-connect-status={data.status}
              data-connect-readiness={light === "green" ? "ready" : "required"}
            >
              {statusLabel}
            </p>
            {!data.stripeConfigured ? (
              <p className="text-sm opacity-90">{t("business.billing.connect.notConfigured")}</p>
            ) : (
              <p className="text-sm opacity-90">
                {t(
                  light === "green"
                    ? "business.billing.connect.statusReadyBody"
                    : light === "yellow"
                      ? "business.billing.connect.nextStepHint"
                      : "business.billing.connect.statusNotConnectedBody",
                )}
              </p>
            )}
            {data.stripeConfigured && data.hasAccount && !data.chargesEnabled ? (
              <p className="text-sm opacity-90">{t("business.billing.connect.chargesOff")}</p>
            ) : null}
            {data.stripeConfigured && data.hasAccount && !data.payoutsEnabled ? (
              <p className="text-sm opacity-90">{t("business.billing.connect.payoutsOff")}</p>
            ) : null}
          </div>
          {ctaKey && canStart ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void startOnboarding()}
              className={cn(
                "inline-flex h-10 w-full shrink-0 items-center justify-center rounded-md px-4 text-sm font-semibold transition sm:w-auto",
                "bg-foreground text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              {busy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  {t("business.billing.connect.starting")}
                </>
              ) : (
                t(ctaKey)
              )}
            </button>
          ) : null}
        </div>
      </div>

      {data.hasAccount ? (
        <dl className="grid gap-3 border-t border-border/80 pt-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("business.billing.connect.accountVenueLabel")}
            </dt>
            <dd className="mt-1 font-medium text-foreground">{venueName || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("business.billing.connect.payoutStatusLabel")}
            </dt>
            <dd className="mt-1 font-medium text-foreground">
              {data.payoutsEnabled
                ? t("business.billing.connect.payoutEnabled")
                : t("business.billing.connect.payoutRestricted")}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("business.billing.connect.lastSyncLabel")}
            </dt>
            <dd className="mt-1 font-medium text-foreground">
              {lastSync || t("business.billing.connect.lastSyncUnavailable")}
            </dd>
          </div>
        </dl>
      ) : null}

      {data.hasAccount ? (
        <p className="text-sm">
          <Link
            to="/dashboard/stripe/payouts"
            className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
          >
            {t("business.billing.connect.viewPayouts")}
          </Link>
          {light === "green" && canStart ? (
            <>
              <span className="mx-2 text-muted-foreground" aria-hidden>
                ·
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void startOnboarding()}
                className="font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                {t("business.billing.connect.manage")}
              </button>
            </>
          ) : null}
        </p>
      ) : (
        <p className="text-sm">
          <Link
            to="/dashboard/stripe/payouts"
            className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
          >
            {t("business.billing.connect.viewPayouts")}
          </Link>
        </p>
      )}
    </section>
  );
}
