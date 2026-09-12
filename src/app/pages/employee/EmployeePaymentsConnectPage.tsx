import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { EmployeePageHeader } from "../../components/employee/EmployeePageHeader";
import { EmployeePayoutAccountCard } from "../../components/employee/EmployeePayoutAccountCard";
import { EmployeeInstantPayoutCard } from "../../components/employee/EmployeeInstantPayoutCard";
import { EmployeePayoutDashboardMetrics } from "../../components/employee/EmployeePayoutDashboardMetrics";
import { EmployeeReceivingPausedBanner } from "../../components/employee/EmployeeReceivingPausedBanner";
import { EmployeeStripeBankPayoutList } from "../../components/employee/EmployeeStripeBankPayoutList";
import { EmployeeTipDistributionNotice } from "../../components/employee/EmployeeTipDistributionNotice";
import { isEmployeeBusinessDistributionMode } from "../../components/employee/employeePayoutActivityPresentation";
import { EMPLOYEE_PAYMENTS_HISTORY_HREF } from "../../components/employee/employeeDashboardNav";
import { employeeUi } from "../../components/employee/employeeDashboardUi";
import { cn } from "@/lib/utils";
import {
  getEmployeeConnectStatus,
  getEmployeeInstantPayoutEligibility,
  getEmployeeProfile,
  type EmployeeInstantPayoutEligibility,
} from "../../lib/api";
import { Button } from "../../components/ui/button";

export function EmployeePaymentsConnectPage() {
  const { t } = useTranslation();
  const [receivingPaused, setReceivingPaused] = useState(false);
  const [businessName, setBusinessName] = useState("");
  const [routingReady, setRoutingReady] = useState(false);
  const [businessDistribution, setBusinessDistribution] = useState(false);
  const [eligibility, setEligibility] = useState<EmployeeInstantPayoutEligibility | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [eligibilityError, setEligibilityError] = useState<string | null>(null);

  const reloadEligibility = useCallback(async () => {
    setMetricsLoading(true);
    setEligibilityError(null);
    try {
      const next = await getEmployeeInstantPayoutEligibility();
      setEligibility(next);
    } catch {
      setEligibility(null);
      setEligibilityError(t("employee.payouts.instant.loadError"));
    } finally {
      setMetricsLoading(false);
    }
  }, [t]);

  const load = useCallback(() => {
    void getEmployeeProfile({ silent: true })
      .then((p) => {
        setReceivingPaused(p.receivingPaused === true);
        setBusinessName(p.businessName?.trim() ?? "");
      })
      .catch(() => undefined);
    void getEmployeeConnectStatus()
      .then((s) => {
        setBusinessDistribution(isEmployeeBusinessDistributionMode(s.employeeTipPayoutMode));
        setRoutingReady(true);
      })
      .catch(() => {
        setBusinessDistribution(false);
        setRoutingReady(true);
      });
    void reloadEligibility();
  }, [reloadEligibility]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className={cn(employeeUi.page, "employee-payments-connect-page")}>
      <div className={cn(employeeUi.pageInner, "mx-auto max-w-6xl space-y-6")}>
        <EmployeePageHeader
          kicker={t("dashboardNav.employee.payments")}
          title={t("employee.payouts.title")}
          description={t("employee.payouts.connectSubtitle")}
          backAriaLabel={t("employee.payouts.backAria")}
          backVariant="subtle"
          actions={
            <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto">
              <Button asChild variant="outline" className={cn(employeeUi.btnSecondary, "h-auto min-h-11 w-full whitespace-normal sm:w-auto")}>
                <Link to={EMPLOYEE_PAYMENTS_HISTORY_HREF}>{t("employee.payouts.dashboard.viewHistory")}</Link>
              </Button>
            </div>
          }
        />
        <EmployeeReceivingPausedBanner receivingPaused={receivingPaused} onReactivated={load} />
        {businessDistribution ? <EmployeeTipDistributionNotice businessName={businessName} /> : null}
        <EmployeePayoutDashboardMetrics eligibility={eligibility} loading={metricsLoading} />
        <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_21rem]">
          <div className="order-1 min-w-0 space-y-4 xl:order-2">
            <EmployeeInstantPayoutCard
              businessDistribution={businessDistribution}
              routingReady={routingReady}
              layout="rail"
              sharedEligibility={eligibility}
              sharedLoading={metricsLoading}
              sharedError={eligibilityError}
              onSharedReload={reloadEligibility}
              onSharedEligibilityChange={setEligibility}
            />
            <EmployeePayoutAccountCard
              businessDistribution={businessDistribution}
              last4={eligibility?.destinationLast4 ?? null}
              destinationKind={eligibility?.destinationKind ?? null}
              layout="rail"
            />
          </div>
          <div className="order-2 min-w-0 xl:order-1">
            <EmployeeStripeBankPayoutList variant="panel" take={8} />
          </div>
        </div>
      </div>
    </div>
  );
}
