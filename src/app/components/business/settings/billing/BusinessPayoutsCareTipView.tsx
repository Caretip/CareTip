import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import {
  getEmployeeStripeConnections,
  getEmployeeTipRoutingOverview,
  type EmployeePayoutConnectionState,
  type EmployeeTipPayoutMode,
  type EmployeeTipRoutingOverview,
  type ManagerEmployeeStripeConnection,
} from "../../../../lib/api";
import { toUserFriendlyMessage } from "../../../../lib/errorMessages";
import { logClientError } from "../../../../lib/clientLog";
import { formatEur } from "../../../../lib/formatEur";
import { Button } from "../../../ui/button";
import { businessUi } from "../../businessDashboardUi";
import { FinanceStatusPill } from "../../../finance/FinanceStatusPill";
import type { FinanceStatusTone } from "../../../finance/FinanceStatusDot";
import { cn } from "@/lib/utils";

const PILL_TONE: Record<EmployeePayoutConnectionState, FinanceStatusTone> = {
  connected: "success",
  setup_required: "warning",
  action_required: "warning",
  restricted: "danger",
  not_connected: "neutral",
};

const READY_STATES: EmployeePayoutConnectionState[] = ["connected"];

export function BusinessPayoutsCareTipView() {
  const { t } = useTranslation();
  const [overview, setOverview] = useState<EmployeeTipRoutingOverview | null>(null);
  const [rows, setRows] = useState<ManagerEmployeeStripeConnection[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    void Promise.all([getEmployeeTipRoutingOverview(), getEmployeeStripeConnections()])
      .then(([nextOverview, connections]) => {
        setOverview(nextOverview);
        setRows(connections.employees);
        setTruncated(connections.truncated);
      })
      .catch((err) => {
        logClientError("BusinessPayoutsCareTipView", err);
        setOverview(null);
        setRows(null);
        setError(toUserFriendlyMessage(err) || t("business.stripe.payoutsWorkspace.caretip.loadError"));
      });
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    window.addEventListener("focus", load);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", load);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const mode: EmployeeTipPayoutMode | null = overview?.mode ?? null;
  const isBusinessDistribution = mode === "business_distribution";
  const connectedCount = useMemo(
    () => (rows ?? []).filter((row) => READY_STATES.includes(row.connectionState)).length,
    [rows],
  );
  const notReadyCount = (rows?.length ?? 0) - connectedCount;

  if (error) {
    return (
      <div className="space-y-3" role="alert">
        <p className="text-sm text-destructive">{error}</p>
        <Button type="button" variant="outline" className={businessUi.btnSecondary} onClick={load}>
          {t("business.stripe.payoutsWorkspace.caretip.retry")}
        </Button>
      </div>
    );
  }

  if (!overview || rows == null) {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="h-24 animate-pulse rounded-xl bg-muted" />
        <div className="h-40 animate-pulse rounded-xl bg-muted" />
        <span className="sr-only">{t("business.stripe.payoutsWorkspace.caretip.loading")}</span>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section
        className="rounded-xl border border-border bg-card p-4 sm:p-5"
        aria-labelledby="payouts-caretip-routing-heading"
      >
        <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
          {t("business.stripe.payoutsWorkspace.caretip.kicker")}
        </p>
        <h2 id="payouts-caretip-routing-heading" className="mt-1 text-base font-semibold tracking-tight">
          {isBusinessDistribution
            ? t("business.stripe.payoutsWorkspace.caretip.businessTitle")
            : t("business.stripe.payoutsWorkspace.caretip.directTitle")}
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          {isBusinessDistribution
            ? t("business.stripe.payoutsWorkspace.caretip.businessLead")
            : t("business.stripe.payoutsWorkspace.caretip.directLead")}
        </p>
        {isBusinessDistribution ? (
          <ol className="mt-4 max-w-xl space-y-1.5 text-sm text-foreground">
            <li>{t("business.stripe.payoutsWorkspace.caretip.businessStep1")}</li>
            <li>{t("business.stripe.payoutsWorkspace.caretip.businessStep2")}</li>
            <li>{t("business.stripe.payoutsWorkspace.caretip.businessStep3")}</li>
          </ol>
        ) : (
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border/80 bg-muted/20 p-3">
              <dt className="text-xs font-medium text-muted-foreground">
                {t("business.stripe.payoutsWorkspace.caretip.connectedPathLabel")}
              </dt>
              <dd className="mt-1 text-sm leading-snug">
                {t("business.stripe.payoutsWorkspace.caretip.connectedPath")}
              </dd>
            </div>
            <div className="rounded-lg border border-border/80 bg-muted/20 p-3">
              <dt className="text-xs font-medium text-muted-foreground">
                {t("business.stripe.payoutsWorkspace.caretip.unconnectedPathLabel")}
              </dt>
              <dd className="mt-1 text-sm leading-snug">
                {t("business.stripe.payoutsWorkspace.caretip.unconnectedPath")}
              </dd>
            </div>
          </dl>
        )}
        <p className="mt-4 text-xs text-muted-foreground">{t("business.stripe.payoutsWorkspace.caretip.appliesNew")}</p>
        <Button asChild variant="outline" className={cn(businessUi.btnSecondary, "mt-4 h-auto min-h-11")}>
          <Link to="/dashboard/stripe/connect">{t("business.stripe.payoutsWorkspace.caretip.changeOnConnect")}</Link>
        </Button>
      </section>

      {overview.heldRowCount > 0 ? (
        <section className="rounded-xl border border-border bg-card p-4 sm:p-5" aria-labelledby="payouts-caretip-holds-heading">
          <h2 id="payouts-caretip-holds-heading" className="text-base font-semibold tracking-tight">
            {t("business.stripe.payoutsWorkspace.caretip.holdsTitle")}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("business.stripe.payoutsWorkspace.caretip.holdsBody")}
          </p>
          <p className="mt-3 text-2xl font-semibold tabular-nums tracking-tight">
            {formatEur(overview.heldPlatformCents / 100)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("business.stripe.payoutsWorkspace.caretip.holdsCount", { count: overview.heldRowCount })}
          </p>
        </section>
      ) : null}

      <section aria-labelledby="payouts-caretip-employees-heading">
        <h2 id="payouts-caretip-employees-heading" className="text-base font-semibold tracking-tight">
          {isBusinessDistribution
            ? t("business.stripe.payoutsWorkspace.caretip.accountsTitleBusiness")
            : t("business.stripe.payoutsWorkspace.caretip.accountsTitle")}
        </h2>
        <p className="mt-1 mb-4 max-w-3xl text-sm text-muted-foreground">
          {isBusinessDistribution
            ? t("business.stripe.payoutsWorkspace.caretip.accountsHintBusiness")
            : t("business.stripe.payoutsWorkspace.caretip.accountsHint")}
        </p>

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("business.stripe.employeeConnections.emptyRoster")}</p>
        ) : (
          <>
            <dl className="mb-4 grid grid-cols-2 gap-3 sm:max-w-md">
              <div>
                <dt className="text-xs font-medium text-muted-foreground">
                  {t("business.stripe.employeeConnections.connectedLabel")}
                </dt>
                <dd className="text-sm font-semibold tabular-nums">
                  {t("business.stripe.employeeConnections.employeeCount", { count: connectedCount })}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground">
                  {t("business.stripe.payoutsWorkspace.caretip.notReadyLabel")}
                </dt>
                <dd className="text-sm font-semibold tabular-nums">
                  {t("business.stripe.employeeConnections.employeeCount", { count: notReadyCount })}
                </dd>
              </div>
            </dl>
            <div className={businessUi.mobileList}>
              {rows.map((row) => (
                <div key={row.id} className={businessUi.mobileCard}>
                  <p className="text-sm font-medium">{row.name}</p>
                  <div className="mt-2">
                    <FinanceStatusPill
                      tone={PILL_TONE[row.connectionState]}
                      label={t(`business.staffPage.payoutState.${row.connectionState}`)}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className={businessUi.tableWrap}>
              <table className="w-full min-w-[28rem] text-left text-sm">
                <caption className="sr-only">{t("business.stripe.payoutsWorkspace.caretip.tableCaption")}</caption>
                <thead>
                  <tr className="border-b border-border text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="py-2.5 pr-4 font-medium">
                      {t("business.stripe.payoutsWorkspace.caretip.colEmployee")}
                    </th>
                    <th scope="col" className="py-2.5 font-medium">
                      {t("business.stripe.payoutsWorkspace.caretip.colStatus")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-border/70 last:border-0">
                      <td className="py-3 pr-4 font-medium">{row.name}</td>
                      <td className="py-3">
                        <FinanceStatusPill
                          className="w-fit"
                          tone={PILL_TONE[row.connectionState]}
                          label={t(`business.staffPage.payoutState.${row.connectionState}`)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {truncated ? (
              <p className="mt-3 text-xs text-muted-foreground">
                {t("business.stripe.employeeConnections.truncated")}{" "}
                <Link to="/dashboard/team" className="font-medium underline-offset-4 hover:underline">
                  {t("business.stripe.employeeConnections.viewTeam")}
                </Link>
              </p>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
