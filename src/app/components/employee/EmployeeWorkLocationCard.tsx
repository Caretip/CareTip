import { MapPin } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EmployeeSelfAssignment } from "../../lib/api";
import { employeeTipLocations } from "../../lib/employeeTipLocations";

type Props = {
  assignment: EmployeeSelfAssignment | undefined;
  loading?: boolean;
  loadFailed?: boolean;
};

export function EmployeeWorkLocationCard({ assignment, loading = false, loadFailed = false }: Props) {
  const { t } = useTranslation();
  const locations = employeeTipLocations(assignment);
  const tables = assignment?.tables ?? [];
  const tableNames = tables
    .map((table) => table.name?.trim())
    .filter((name): name is string => Boolean(name));

  return (
    <section
      className="employee-work-location"
      aria-labelledby="employee-work-location-heading"
      aria-busy={loading || undefined}
    >
      <h2 id="employee-work-location-heading" className="employee-work-location__label">
        <MapPin className="employee-work-location__icon" aria-hidden />
        {t("employee.workLocation.title")}
      </h2>

      {loading ? (
        <p className="employee-work-location__status">{t("employee.workLocation.loading")}</p>
      ) : loadFailed ? (
        <p className="employee-work-location__status">{t("employee.workLocation.loadError")}</p>
      ) : locations.length === 0 ? (
        <div className="employee-work-location__body">
          <p className="employee-work-location__name">{t("employee.workLocation.emptyTitle")}</p>
          <p className="employee-work-location__hint">{t("employee.workLocation.emptyHint")}</p>
        </div>
      ) : (
        <div className="employee-work-location__body">
          <ul className="employee-work-location__names">
            {locations.map((location) => (
              <li key={location.id} className="employee-work-location__name">
                {location.name}
              </li>
            ))}
          </ul>
          <p className="employee-work-location__hint">{t("employee.workLocation.hint")}</p>
          {tableNames.length > 0 ? (
            <p className="employee-work-location__tables">
              {t("employee.workLocation.tables", { names: tableNames.join(", ") })}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
