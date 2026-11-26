import { useTranslation } from "react-i18next";
import { ParticipantDisputesList } from "../../components/disputes/ParticipantDisputesList";
import { EmployeePageHeader } from "../../components/employee/EmployeePageHeader";
import { employeeUi } from "../../components/employee/employeeDashboardUi";
import { cn } from "@/lib/utils";

/** /dashboard/stripe/disputes — rendered inside the Stripe module layout (header comes from there). */
export function BusinessStripeDisputesPage() {
  return (
    <div className="mt-4">
      <ParticipantDisputesList audience="business" />
    </div>
  );
}

/** /employee/payments/disputes */
export function EmployeeDisputesPage() {
  const { t } = useTranslation();
  return (
    <div className={cn(employeeUi.page, "employee-disputes-page")}>
      <div className={cn(employeeUi.pageInner, "mx-auto max-w-4xl space-y-6")}>
        <EmployeePageHeader
          kicker={t("dashboardNav.employee.payments")}
          title={t("disputes.participant.title")}
          description={t("disputes.participant.subtitle_employee")}
          backAriaLabel={t("employee.payouts.backAria")}
          backVariant="subtle"
        />
        <ParticipantDisputesList audience="employee" />
      </div>
    </div>
  );
}
