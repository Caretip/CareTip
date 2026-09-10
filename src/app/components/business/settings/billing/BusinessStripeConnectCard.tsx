import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createConnectAccountLink, createConnectLoginLink, type ConnectStatus } from "../../../../lib/api";
import { fetchConnectStatusCached } from "../../../../lib/stripeConnectStatusCache";
import {
  stripeConnectCtaKey,
  stripeConnectHeadlineKey,
  stripeConnectShowsDashboardAccess,
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
import { Button } from "../../../ui/button";
import { FinanceStatusDot, type FinanceStatusTone } from "../../../finance/FinanceStatusDot";
import { cn } from "@/lib/utils";

function connectTone(light: ReturnType<typeof stripeConnectTrafficLight>): FinanceStatusTone {
  if (light === "green") return "success";
  if (light === "yellow") return "warning";
  return "danger";
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
  const [busy, setBusy] = useState<"onboarding" | "dashboard" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const venueName = user?.businessName?.trim() || user?.name?.trim() || "";

  useAppLoadingRegistration(
    "stripe-connect-onboarding",
    APP_LOADING_PRIORITY.APP_INIT,
    busy != null,
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
    setBusy("onboarding");
    try {
      const { url } = await createConnectAccountLink();
      const redirect = performExternalStripeRedirect(url, "connect");
      if (!redirect.ok) {
        toast.error(t("business.billing.connect.startError"));
        setBusy(null);
      }
    } catch (err) {
      toast.error(toUserFriendlyMessage(err) || t("business.billing.connect.startError"));
      setBusy(null);
    }
  }

  async function startDashboard() {
    setBusy("dashboard");
    try {
      const { url } = await createConnectLoginLink();
      const redirect = performExternalStripeRedirect(url, "expressDashboard");
      if (!redirect.ok) {
        toast.error(t("business.billing.connect.openDashboardError"));
        setBusy(null);
      }
    } catch (err) {
      toast.error(toUserFriendlyMessage(err) || t("business.billing.connect.openDashboardError"));
      setBusy(null);
    }
  }

  if (loading && !data) {
    return (
      <div className="flex min-h-[72px] items-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        <span>{t("business.billing.connect.loading")}</span>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="space-y-3 py-2" role="alert">
        <p className="text-sm text-destructive">{error}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void reload(true)}>
          {t("business.billing.retry")}
        </Button>
      </div>
    );
  }

  if (!data) return null;

  const canStart = data.stripeConfigured;
  const light = stripeConnectTrafficLight(data);
  const ctaKey = stripeConnectCtaKey(data);
  const showDashboard = stripeConnectShowsDashboardAccess(data);
  const statusLabel = t(stripeConnectHeadlineKey(data));
  const lastSync =
    data.updatedAt && data.updatedAt.trim()
      ? formatBerlinDateTime(data.updatedAt, i18n.language)
      : null;
  const actionBusy = busy != null;
  const tone = connectTone(light);
  const showUpdate = light === "green" && canStart && data.hasAccount;
  const showOnboardingPrimary = Boolean(ctaKey && canStart);

  return (
    <section className="space-y-6" aria-labelledby="stripe-connect-overview">
      <div className="flex flex-col gap-4 border-b border-border/80 pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h2 id="stripe-connect-overview" className="sr-only">
            {t("business.billing.connect.accountSummaryTitle")}
          </h2>
          <FinanceStatusDot
            tone={tone}
            label={statusLabel}
            className="text-[0.8125rem]"
          />
          {lastSync ? (
            <p className="text-xs text-muted-foreground">
              {t("business.billing.connect.lastSyncLabel")}: {lastSync}
            </p>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          {showDashboard && canStart ? (
            <Button
              type="button"
              disabled={actionBusy}
              aria-busy={busy === "dashboard"}
              onClick={() => void startDashboard()}
              className="h-auto min-h-10 w-full whitespace-normal sm:w-auto"
            >
              {busy === "dashboard" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {t("business.billing.connect.openDashboard")}
            </Button>
          ) : null}
          {showOnboardingPrimary ? (
            <Button
              type="button"
              variant={showDashboard ? "outline" : "default"}
              disabled={actionBusy}
              aria-busy={busy === "onboarding"}
              onClick={() => void startOnboarding()}
              className="h-auto min-h-10 w-full whitespace-normal sm:w-auto"
            >
              {busy === "onboarding" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {t(ctaKey!)}
            </Button>
          ) : null}
          {showUpdate ? (
            <Button
              type="button"
              variant="outline"
              disabled={actionBusy}
              onClick={() => void startOnboarding()}
              className="h-auto min-h-10 w-full whitespace-normal sm:w-auto"
            >
              {t("business.billing.connect.manage")}
            </Button>
          ) : null}
        </div>
      </div>

      {!data.stripeConfigured ? (
        <p className="text-sm text-muted-foreground">{t("business.billing.connect.notConfigured")}</p>
      ) : null}

      <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="min-w-0">
          <dt className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
            {t("business.billing.connect.accountVenueLabel")}
          </dt>
          <dd className="mt-1 truncate text-sm font-medium">{venueName || "—"}</dd>
        </div>
        <div>
          <dt className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
            {t("business.billing.connect.payoutStatusLabel")}
          </dt>
          <dd className="mt-1 text-sm font-medium">
            {data.hasAccount
              ? data.payoutsEnabled
                ? t("business.billing.connect.payoutEnabled")
                : t("business.billing.connect.payoutRestricted")
              : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
            {t("business.billing.connect.accountStatusLabel")}
          </dt>
          <dd
            className="mt-1 text-sm font-medium"
            data-connect-status={data.status}
            data-connect-readiness={light === "green" ? "ready" : "required"}
          >
            {statusLabel}
          </dd>
        </div>
        <div>
          <dt className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
            {t("business.billing.connect.lastSyncLabel")}
          </dt>
          <dd className="mt-1 text-sm font-medium">
            {lastSync || t("business.billing.connect.lastSyncUnavailable")}
          </dd>
        </div>
      </dl>

      {data.stripeConfigured && data.hasAccount && !data.chargesEnabled ? (
        <p className="text-xs text-muted-foreground">{t("business.billing.connect.chargesOff")}</p>
      ) : null}
      {data.stripeConfigured && data.hasAccount && !data.payoutsEnabled ? (
        <p className="text-xs text-muted-foreground">{t("business.billing.connect.payoutsOff")}</p>
      ) : null}
    </section>
  );
}
