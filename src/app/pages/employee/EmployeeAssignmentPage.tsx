import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRequireAuth } from "../../hooks/useRequireAuth";
import { useDashboardTabRefocus } from "../../hooks/useDashboardTabRefocus";
import {
  clearEmployeeProfileClientCache,
  getEmployeeProfile,
  type EmployeeSelfAssignment,
} from "../../lib/api";
import { EmployeeAssignmentCard } from "../../components/employee/EmployeeAssignmentCard";
import { EmployeePageHeader } from "../../components/employee/EmployeePageHeader";
import { employeeUi } from "../../components/employee/employeeDashboardUi";
import { cn } from "@/lib/utils";

export function EmployeeAssignmentPage() {
  const { t } = useTranslation();
  const { user, authHydrated, sessionValidated, authReady } = useRequireAuth();
  const [assignment, setAssignment] = useState<EmployeeSelfAssignment | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);

  const pageEnabled = Boolean(authReady && user?.role === "employee");

  const loadAssignment = useCallback(async () => {
    try {
      const profile = await getEmployeeProfile();
      setAssignment(profile.assignment);
    } catch {
      setAssignment(undefined);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!authHydrated || !sessionValidated || !user || user.role !== "employee") return;
    let cancelled = false;
    clearEmployeeProfileClientCache();
    void (async () => {
      await loadAssignment();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [authHydrated, sessionValidated, user?.id, user?.role, loadAssignment]);

  useDashboardTabRefocus(() => {
    clearEmployeeProfileClientCache();
    void loadAssignment();
  }, pageEnabled);

  return (
    <div className={cn(employeeUi.page, "employee-assignment-page")}>
      <div className={employeeUi.pageInner}>
        <EmployeePageHeader
          title={t("employee.assignment.title")}
          description={t("employee.assignment.subtitle").trim() || undefined}
          backAriaLabel={t("employee.assignment.backAria")}
        />
        <section className={cn(employeeUi.section, "pb-6")} aria-labelledby="employee-assignment-heading">
          <h2 id="employee-assignment-heading" className="sr-only">
            {t("employee.assignment.title")}
          </h2>
          <EmployeeAssignmentCard assignment={assignment} loading={!loaded} showHeader={false} />
        </section>
      </div>
    </div>
  );
}
