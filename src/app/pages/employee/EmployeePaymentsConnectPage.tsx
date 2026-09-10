import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { EmployeePageHeader } from "../../components/employee/EmployeePageHeader";
import { EmployeePayoutAccountCard } from "../../components/employee/EmployeePayoutAccountCard";
import { EmployeeInstantPayoutCard } from "../../components/employee/EmployeeInstantPayoutCard";
import { EmployeeReceivingPausedBanner } from "../../components/employee/EmployeeReceivingPausedBanner";
import { employeeUi } from "../../components/employee/employeeDashboardUi";
import { cn } from "@/lib/utils";
import { getEmployeeProfile } from "../../lib/api";

export function EmployeePaymentsConnectPage() {
  const { t } = useTranslation();
  const [receivingPaused, setReceivingPaused] = useState(false);

  const load = useCallback(() => {
    void getEmployeeProfile({ silent: true })
      .then((p) => setReceivingPaused(p.receivingPaused === true))
      .catch(() => undefined);
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
        <EmployeeInstantPayoutCard />
        <EmployeePayoutAccountCard />
      </div>
    </div>
  );
}
