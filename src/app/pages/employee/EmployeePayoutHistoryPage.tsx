import { useTranslation } from "react-i18next";
import { EmployeePageHeader } from "../../components/employee/EmployeePageHeader";
import { EmployeePayoutActivityList } from "../../components/employee/EmployeePayoutActivityList";
import { EmployeeStripeBankPayoutList } from "../../components/employee/EmployeeStripeBankPayoutList";
import { employeeUi } from "../../components/employee/employeeDashboardUi";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { cn } from "@/lib/utils";

export function EmployeePayoutHistoryPage() {
  const { t } = useTranslation();

  return (
    <div className={cn(employeeUi.page, "employee-payout-history-page")}>
      <div className={cn(employeeUi.pageInner, "mx-auto max-w-3xl space-y-8")}>
        <EmployeePageHeader
          kicker={t("dashboardNav.employee.payments")}
          title={t("employee.payouts.history.title")}
          description={t("employee.payouts.history.subtitle")}
          backAriaLabel={t("employee.payouts.backAria")}
          backVariant="subtle"
        />
        <Tabs defaultValue="caretip" className="gap-6">
          <TabsList className="h-auto w-full max-w-full flex-wrap sm:w-fit" aria-label={t("employee.payouts.history.tabsAria")}>
            <TabsTrigger value="caretip">{t("employee.payouts.history.caretipTab")}</TabsTrigger>
            <TabsTrigger value="bank">{t("employee.payouts.history.bankTab")}</TabsTrigger>
          </TabsList>
          <TabsContent value="caretip">
            <EmployeePayoutActivityList />
          </TabsContent>
          <TabsContent value="bank">
            <EmployeeStripeBankPayoutList />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
