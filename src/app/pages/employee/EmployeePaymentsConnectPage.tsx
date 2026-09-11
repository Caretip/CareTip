import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { EmployeePageHeader } from "../../components/employee/EmployeePageHeader";
import { EmployeePayoutAccountCard } from "../../components/employee/EmployeePayoutAccountCard";
import { EmployeeInstantPayoutCard } from "../../components/employee/EmployeeInstantPayoutCard";
import { EmployeeReceivingPausedBanner } from "../../components/employee/EmployeeReceivingPausedBanner";
import { EmployeeTipDistributionNotice } from "../../components/employee/EmployeeTipDistributionNotice";
import { isEmployeeBusinessDistributionMode } from "../../components/employee/employeePayoutActivityPresentation";
import { employeeUi } from "../../components/employee/employeeDashboardUi";
import { cn } from "@/lib/utils";
import { getEmployeeConnectStatus, getEmployeeProfile } from "../../lib/api";

export function EmployeePaymentsConnectPage() {
  const { t } = useTranslation();
  const [receivingPaused, setReceivingPaused] = useState(false);
  const [businessName, setBusinessName] = useState("");
  const [routingReady, setRoutingReady] = useState(false);
  const [businessDistribution, setBusinessDistribution] = useState(false);

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
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className={cn(employeeUi.page, "employee-payments-connect-page")}>
      <div className={cn(employeeUi.pageInner, "mx-auto max-w-3xl space-y-10")}>
        <EmployeePageHeader
          kicker={t("dashboardNav.employee.payments")}
          title={t("employee.payouts.connectTitle")}
          description={t("employee.payouts.connectSubtitle")}
          backAriaLabel={t("employee.payouts.backAria")}
          backVariant="subtle"
        />
        <EmployeeReceivingPausedBanner receivingPaused={receivingPaused} onReactivated={load} />
        {businessDistribution ? <EmployeeTipDistributionNotice businessName={businessName} /> : null}
        <EmployeeInstantPayoutCard
          businessDistribution={businessDistribution}
          routingReady={routingReady}
        />
        <EmployeePayoutAccountCard businessDistribution={businessDistribution} />
      </div>
    </div>
  );
}
