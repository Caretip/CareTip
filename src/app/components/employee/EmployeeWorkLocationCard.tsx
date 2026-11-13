import { ChevronRight, MapPin } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { EmployeeSelfAssignment } from "../../lib/api";

type Props = {
  /** Kept for the overview's existing data flow; the details live on /employee/assignment. */
  assignment?: EmployeeSelfAssignment | undefined;
  loading?: boolean;
  loadFailed?: boolean;
};

/** Overview entry point to the employee's tip location page (one row, whole row is the link). */
export function EmployeeWorkLocationCard(_props: Props) {
  const { t } = useTranslation();

  return (
    <Link to="/employee/assignment" className="employee-work-location">
      <span className="employee-work-location__pin" aria-hidden="true">
        <MapPin className="h-5 w-5" strokeWidth={2} />
      </span>
      <span className="employee-work-location__cta">{t("employee.workLocation.viewCta")}</span>
      <ChevronRight className="employee-work-location__chevron h-5 w-5" aria-hidden="true" />
    </Link>
  );
}
