import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import {
  getEmployeeStripeConnections,
  type EmployeePayoutConnectionState,
  type EmployeeTipPayoutMode,
  type ManagerEmployeeStripeConnection,
} from "../../../../lib/api";
import { toUserFriendlyMessage } from "../../../../lib/errorMessages";
import { logClientError } from "../../../../lib/clientLog";
import { Button } from "../../../ui/button";
import { businessUi } from "../../businessDashboardUi";
import { FinanceStatusPill } from "../../../finance/FinanceStatusPill";
import type { FinanceStatusTone } from "../../../finance/FinanceStatusDot";
import { cn } from "@/lib/utils";

const PREVIEW_COUNT = 8;

const PILL_TONE: Record<EmployeePayoutConnectionState, FinanceStatusTone> = {
  connected: "success",
  setup_required: "warning",
  action_required: "warning",
  restricted: "danger",
  not_connected: "neutral",
};

function connectionDetail(
  row: ManagerEmployeeStripeConnection,
  mode: EmployeeTipPayoutMode | null,
  t: (key: string, options?: { suffix?: string }) => string,
): string {
  if (row.accountSuffix) {
    return t("business.stripe.employeeConnections.accountMasked", { suffix: row.accountSuffix });
  }
  switch (row.connectionState) {
    case "connected":
      return mode === "business_distribution"
        ? t("business.stripe.employeeConnections.hintConnectedBusiness")
        : t("business.stripe.employeeConnections.hintConnected");
    case "setup_required":
      return t("business.stripe.employeeConnections.hintSetup");
    case "action_required":
      return t("business.stripe.employeeConnections.hintAction");
    case "restricted":
      return t("business.stripe.employeeConnections.hintRestricted");
    default:
      return mode === "business_distribution"
        ? t("business.stripe.employeeConnections.hintNotConnectedBusiness")
        : t("business.stripe.employeeConnections.hintNotConnectedDirect");
  }
}

export function EmployeeStripeConnectionsCard({
  routingMode,
}: {
  routingMode: EmployeeTipPayoutMode | null;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<ManagerEmployeeStripeConnection[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [listOpen, setListOpen] = useState(true);

  const load = useCallback(() => {
    setError(null);
    void getEmployeeStripeConnections()
      .then((res) => {
        setRows(res.employees);
        setTruncated(res.truncated);
      })
      .catch((err) => {
        logClientError("EmployeeStripeConnectionsCard", err);
        setRows(null);
        setError(toUserFriendlyMessage(err) || t("business.stripe.employeeConnections.loadError"));
      });
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setListOpen(routingMode !== "business_distribution");
    setExpanded(false);
  }, [routingMode]);

  const connectedCount = useMemo(
    () => (rows ?? []).filter((row) => row.connectionState === "connected").length,
    [rows],
  );
  const needsAttentionCount = (rows?.length ?? 0) - connectedCount;
  const visibleRows = useMemo(() => {
    if (!rows) return [];
    if (expanded || rows.length <= PREVIEW_COUNT) return rows;
    return rows.slice(0, PREVIEW_COUNT);
  }, [rows, expanded]);

  const isBusinessDistribution = routingMode === "business_distribution";
  const subtitleKey = isBusinessDistribution
    ? "business.stripe.employeeConnections.subtitleBusiness"
    : "business.stripe.employeeConnections.subtitleDirect";

  return (
    <section className="space-y-4" aria-labelledby="employee-stripe-connections-heading">
      <div className="flex items-baseline justify-between gap-3">
        <h2
          id="employee-stripe-connections-heading"
          className="min-w-0 truncate text-base font-semibold tracking-tight"
        >
          {t("business.stripe.employeeConnections.title")}
        </h2>
        <Link
          to="/dashboard/stripe/payouts"
          className="shrink-0 whitespace-nowrap text-sm font-medium underline-offset-4 hover:underline"
        >
          {t("business.billing.connect.viewPayouts")}
        </Link>
      </div>
      <p className="text-sm text-muted-foreground">{t(subtitleKey)}</p>

      {error ? (
        <div className="space-y-3" role="alert">
          <p className="text-sm text-destructive">{error}</p>
          <Button type="button" variant="outline" className={businessUi.btnSecondary} onClick={load}>
            {t("business.stripe.employeeConnections.retry")}
          </Button>
        </div>
      ) : rows == null ? (
        <p className="text-sm text-muted-foreground" role="status">
          {t("business.stripe.employeeConnections.loading")}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("business.stripe.employeeConnections.emptyRoster")}</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:max-w-md">
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
                {t("business.stripe.employeeConnections.needsAttentionLabel")}
              </dt>
              <dd className="text-sm font-semibold tabular-nums">
                {t("business.stripe.employeeConnections.employeeCount", { count: needsAttentionCount })}
              </dd>
            </div>
          </dl>

          {connectedCount === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t(
                isBusinessDistribution
                  ? "business.stripe.employeeConnections.emptyBusiness"
                  : "business.stripe.employeeConnections.emptyDirect",
              )}
            </p>
          ) : null}

          {isBusinessDistribution && !listOpen ? (
            <Button
              type="button"
              variant="outline"
              className={cn(businessUi.btnSecondary, "h-auto min-h-11 w-full sm:w-auto")}
              onClick={() => setListOpen(true)}
            >
              {t("business.stripe.employeeConnections.viewEmployees")}
            </Button>
          ) : (
            <>
              {isBusinessDistribution ? (
                <Button
                  type="button"
                  variant="outline"
                  className={cn(businessUi.btnSecondary, "h-auto min-h-11 w-full sm:w-auto")}
                  onClick={() => setListOpen(false)}
                >
                  {t("business.stripe.employeeConnections.hideEmployees")}
                </Button>
              ) : null}
              <ul className="divide-y divide-border/80">
                {visibleRows.map((row) => (
                  <li
                    key={row.id}
                    className="flex flex-col gap-1.5 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{row.name}</p>
                      <p className="text-xs text-muted-foreground">{connectionDetail(row, routingMode, t)}</p>
                    </div>
                    <FinanceStatusPill
                      className="w-fit shrink-0"
                      tone={PILL_TONE[row.connectionState]}
                      label={t(`business.staffPage.payoutState.${row.connectionState}`)}
                    />
                  </li>
                ))}
              </ul>
              {rows.length > PREVIEW_COUNT ? (
                <Button
                  type="button"
                  variant="outline"
                  className={cn(businessUi.btnSecondary, "h-auto min-h-11 w-full sm:w-auto")}
                  onClick={() => setExpanded((open) => !open)}
                >
                  {expanded
                    ? t("business.stripe.employeeConnections.showLess")
                    : t("business.stripe.employeeConnections.showMore", { count: rows.length })}
                </Button>
              ) : null}
            </>
          )}

          {truncated ? (
            <p className="text-xs text-muted-foreground">
              {t("business.stripe.employeeConnections.truncated")}{" "}
              <Link to="/dashboard/team" className="font-medium underline-offset-4 hover:underline">
                {t("business.stripe.employeeConnections.viewTeam")}
              </Link>
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
