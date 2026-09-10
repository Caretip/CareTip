import { useTranslation } from "react-i18next";
import { EmployeePageHeader } from "../../components/employee/EmployeePageHeader";
import { EmployeePayoutAccountCard } from "../../components/employee/EmployeePayoutAccountCard";
import { EmployeePayoutActivityList } from "../../components/employee/EmployeePayoutActivityList";
import { employeeUi } from "../../components/employee/employeeDashboardUi";
import { cn } from "@/lib/utils";

export function EmployeePayoutsPage() {
  const { t } = useTranslation();

  return (
    <div className={cn(employeeUi.page, "employee-payouts-page")}>
      <div className={cn(employeeUi.pageInner, "mx-auto max-w-3xl space-y-8")}>
        <EmployeePageHeader
          title={t("employee.payouts.title")}
          description={t("employee.payouts.subtitle")}
          backAriaLabel={t("employee.payouts.backAria")}
          backVariant="subtle"
        />
        <EmployeePayoutAccountCard />
        <EmployeePayoutActivityList />
        <p className="text-xs leading-relaxed text-muted-foreground">{t("employee.payouts.stripeSchedule")}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">{t("employee.payouts.bankPayoutsNote")}</p>
      </div>
    </div>
  );
}
