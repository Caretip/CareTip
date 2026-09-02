import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRequireAuth } from "../../hooks/useRequireAuth";
import { useDashboardTabRefocus } from "../../hooks/useDashboardTabRefocus";
import {
  getEmployeeProfile,
  peekEmployeeProfileCache,
  peekEmployeeProfileSession,
  type EmployeeSelfAssignment,
} from "../../lib/api";
import {
  readEmployeeAssignmentSnapshot,
  writeEmployeeAssignmentSnapshot,
} from "../../lib/employeePageSessionCache";
import { EmployeeAssignmentCard } from "../../components/employee/EmployeeAssignmentCard";
import { EmployeePageHeader } from "../../components/employee/EmployeePageHeader";
import { employeeUi } from "../../components/employee/employeeDashboardUi";
import { cn } from "@/lib/utils";

function readAssignmentFromSession(userId: string | undefined): EmployeeSelfAssignment | undefined {
  if (!userId) return undefined;
  return (
    readEmployeeAssignmentSnapshot(userId) ??
    peekEmployeeProfileSession()?.assignment ??
    peekEmployeeProfileCache()?.assignment ??
    undefined
  );
}

export function EmployeeAssignmentPage() {
  const { t } = useTranslation();
  const { user, authHydrated, sessionValidated, authReady } = useRequireAuth();
  const [boot] = useState(() => readAssignmentFromSession(user?.id));
  const [assignment, setAssignment] = useState<EmployeeSelfAssignment | undefined>(boot);
  const [loaded, setLoaded] = useState(() => boot !== undefined);

  const pageEnabled = Boolean(authReady && user?.role === "employee");

  const loadAssignment = useCallback(async (opts?: { quiet?: boolean }) => {
    try {
      const profile = await getEmployeeProfile();
      setAssignment(profile.assignment);
      if (user?.id) writeEmployeeAssignmentSnapshot(user.id, profile.assignment);
    } catch {
      if (!opts?.quiet) setAssignment(undefined);
    } finally {
      setLoaded(true);
    }
  }, [user?.id]);

  useEffect(() => {
    if (!authHydrated || !sessionValidated || !user || user.role !== "employee") return;
    let cancelled = false;
    const cached = readAssignmentFromSession(user.id);
    if (cached) {
      setAssignment(cached);
      setLoaded(true);
    }
    void (async () => {
      await loadAssignment({ quiet: Boolean(cached) });
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [authHydrated, sessionValidated, user?.id, user?.role, loadAssignment]);

  useDashboardTabRefocus(() => {
    void loadAssignment({ quiet: true });
  }, pageEnabled);

  return (
    <div className={cn(employeeUi.page, "employee-assignment-page")}>
      <div className={employeeUi.pageInner}>
        <EmployeePageHeader
          title={t("employee.assignment.title")}
          description={t("employee.assignment.subtitle").trim() || undefined}
          backAriaLabel={t("employee.assignment.backAria")}
          backVariant="subtle"
        />
        <section
          className={cn(employeeUi.section, "employee-assignment-page__content pb-6")}
          aria-labelledby="employee-assignment-heading"
        >
          <h2 id="employee-assignment-heading" className="sr-only">
            {t("employee.assignment.title")}
          </h2>
          <EmployeeAssignmentCard assignment={assignment} loading={!loaded} showHeader={false} />
        </section>
      </div>
    </div>
  );
}
