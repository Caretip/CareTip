import { useTranslation } from "react-i18next";
import { EmployeePageHeader } from "../../components/employee/EmployeePageHeader";
import { EmployeePayoutAccountCard } from "../../components/employee/EmployeePayoutAccountCard";
import { employeeUi } from "../../components/employee/employeeDashboardUi";
import { cn } from "@/lib/utils";

export function EmployeePayoutsPage() {
  const { t } = useTranslation();

  return (
    <div className={cn(employeeUi.page, "employee-payouts-page")}>
      <div className={cn(employeeUi.pageInner, "dashboard-page-narrow mx-auto max-w-2xl space-y-0")}>
        <EmployeePageHeader
          title={t("employee.payouts.title")}
          description={t("employee.payouts.subtitle")}
          backAriaLabel={t("employee.payouts.backAria")}
          backVariant="subtle"
        />
        <EmployeePayoutAccountCard />
      </div>
    </div>
  );
}
