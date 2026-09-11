import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createConnectAccountLink, createConnectLoginLink, type ConnectStatus } from "../../../../lib/api";
import { fetchConnectStatusCached } from "../../../../lib/stripeConnectStatusCache";
import {
  stripeConnectBodyKey,
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
import { businessUi } from "../../businessDashboardUi";
import { cn } from "@/lib/utils";
import { FinanceStatusPill } from "../../../finance/FinanceStatusPill";
import type { FinanceStatusTone } from "../../../finance/FinanceStatusDot";
import { useBusinessStripeHeaderActions } from "../../BusinessStripeHeaderActions";

function connectTone(light: ReturnType<typeof stripeConnectTrafficLight>): FinanceStatusTone {
  if (light === "green") return "success";
  if (light === "yellow") return "warning";
  return "danger";
}

const headerActionClass = cn(
  businessUi.btnPrimary,
  "h-auto min-h-11 w-full whitespace-normal px-5 sm:w-auto",
);

/**
 * Stripe Connect Express status — traffic-light presentation of backend ConnectStatus.
 */
export function BusinessStripeConnectCard() {
  const { t, i18n } = useTranslation();
  const { user } = useRequireAuth();
  const headerActions = useBusinessStripeHeaderActions();
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

  const startOnboarding = useCallback(async function startOnboarding() {
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
  }, [t]);

  const startDashboard = useCallback(async function startDashboard() {
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
  }, [t]);

  const showDashboard = Boolean(data && stripeConnectShowsDashboardAccess(data) && data.stripeConfigured);

  useLayoutEffect(() => {
    const setActions = headerActions?.setActions;
    if (!setActions) return;
    if (!showDashboard) {
      setActions(null);
      return;
    }
    setActions(
      <Button
        type="button"
        disabled={busy != null}
        aria-busy={busy === "dashboard"}
        onClick={() => void startDashboard()}
        className={headerActionClass}
      >
        {busy === "dashboard" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
        {t("business.billing.connect.openDashboard")}
      </Button>,
    );
    return () => setActions(null);
  }, [headerActions, showDashboard, busy, startDashboard, t]);

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
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={businessUi.btnSecondary}
          onClick={() => void reload(true)}
        >
          {t("business.billing.retry")}
        </Button>
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
  const actionBusy = busy != null;
  const tone = connectTone(light);
  const showUpdate = light === "green" && canStart && data.hasAccount;
  const showOnboardingPrimary = Boolean(ctaKey && canStart);

  const headline =
    light === "green" ? t("business.billing.connect.connectedReady") : statusLabel;

  const sectionActions = showOnboardingPrimary || showUpdate;

  return (
    <section
      className="stripe-connect-card space-y-5"
      aria-labelledby="stripe-connect-overview"
    >
      <div className="min-w-0 space-y-2">
        <h2 id="stripe-connect-overview" className="text-base font-semibold tracking-tight">
          {t("business.billing.connect.stripeAccountTitle")}
        </h2>
        <p
          className="text-xl font-semibold tracking-tight sm:text-2xl"
          data-connect-status={data.status}
          data-connect-readiness={light === "green" ? "ready" : "required"}
        >
          {headline}
        </p>
        {venueName ? <p className="text-sm font-medium">{venueName}</p> : null}
        {data.hasAccount ? (
          <p className="text-sm text-muted-foreground">{t("business.billing.connect.expressAccount")}</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <FinanceStatusPill tone={tone} label={statusLabel} />
          {data.hasAccount ? (
            <FinanceStatusPill
              tone={data.payoutsEnabled ? "success" : "warning"}
              label={
                data.payoutsEnabled
                  ? t("business.billing.connect.payoutsEnabledPill")
                  : t("business.billing.connect.payoutRestricted")
              }
            />
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          {t("business.billing.connect.lastSyncLabel")}:{" "}
          {lastSync || t("business.billing.connect.lastSyncUnavailable")}
        </p>
        {light !== "green" ? (
          <p className="max-w-xl text-sm text-muted-foreground">{t(stripeConnectBodyKey(data))}</p>
        ) : null}
      </div>

      {sectionActions ? (
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap">
          {showOnboardingPrimary ? (
            <Button
              type="button"
              disabled={actionBusy}
              aria-busy={busy === "onboarding"}
              onClick={() => void startOnboarding()}
              className={cn(
                businessUi.btnPrimary,
                "h-auto min-h-11 w-full whitespace-normal sm:w-auto",
              )}
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
              className={cn(businessUi.btnSecondary, "h-auto min-h-11 w-full whitespace-normal sm:w-auto")}
            >
              {t("business.billing.connect.manage")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {!data.stripeConfigured ? (
        <p className="text-sm text-muted-foreground">{t("business.billing.connect.notConfigured")}</p>
      ) : null}

      {data.stripeConfigured && data.hasAccount && !data.chargesEnabled ? (
        <p className="text-xs text-muted-foreground">{t("business.billing.connect.chargesOff")}</p>
      ) : null}
      {data.stripeConfigured && data.hasAccount && !data.payoutsEnabled ? (
        <p className="text-xs text-muted-foreground">{t("business.billing.connect.payoutsOff")}</p>
      ) : null}
    </section>
  );
}
