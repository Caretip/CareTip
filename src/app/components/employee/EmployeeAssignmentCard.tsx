import { Info, MapPin, Utensils } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EmployeeSelfAssignment } from "../../lib/api";
import { cn } from "@/lib/utils";

type Venue = { name: string | null; logo: string | null };

type Props = {
  /**
   * Exactly what the business assigned (GET /api/employees/me → `assignment`): the employee's location
   * and table assignments, already limited to the employee's own business. Nothing here is derived.
   */
  assignment: EmployeeSelfAssignment | undefined;
  loading?: boolean;
  /** Venue name and logo from the employee profile. */
  venue?: Venue;
  /** When false, omit the page title block (page header already provides it). */
  showHeader?: boolean;
};

function venueInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "·";
}

export function EmployeeAssignmentCard({ assignment, loading, venue, showHeader = true }: Props) {
  const { t } = useTranslation();
  const location = assignment?.location ?? null;
  const tables = assignment?.tables ?? [];
  const booting = Boolean(loading && assignment === undefined);
  const venueName = venue?.name?.trim() || null;

  return (
    <div className="employee-workplace w-full min-w-0" aria-busy={booting || undefined}>
      {showHeader ? (
        <div className="mb-5">
          <h2 className="text-lg font-semibold tracking-tight text-foreground sm:text-xl">
            {t("employee.assignment.title")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("employee.assignment.subtitle")}</p>
        </div>
      ) : null}

      <div className="employee-workplace__grid">
        {/* Assigned location */}
        <section
          className={cn("employee-workplace__location", !location && !booting && "employee-workplace__location--empty")}
          aria-labelledby="employee-workplace-location-heading"
        >
          {venueName ? (
            <div className="employee-workplace__venue">
              {venue?.logo ? (
                <img className="employee-workplace__venue-logo" src={venue.logo} alt="" aria-hidden="true" />
              ) : (
                <span className="employee-workplace__venue-logo employee-workplace__venue-logo--initials" aria-hidden="true">
                  {venueInitials(venueName)}
                </span>
              )}
              <span className="employee-workplace__venue-name">{venueName}</span>
            </div>
          ) : null}

          <div className="employee-workplace__location-head">
            <span className="employee-workplace__pin" aria-hidden="true">
              <MapPin className="h-5 w-5" strokeWidth={2} />
            </span>
            <h3 id="employee-workplace-location-heading" className="employee-workplace__eyebrow">
              {t("employee.assignment.locationLabel")}
            </h3>
          </div>

          {booting ? (
            <div className="employee-workplace__skeleton-stack" aria-hidden="true">
              <span className="employee-workplace__skeleton employee-workplace__skeleton--title" />
              <span className="employee-workplace__skeleton employee-workplace__skeleton--line" />
            </div>
          ) : location ? (
            <>
              <p className="employee-workplace__location-name">{location.name}</p>
              {location.description ? (
                <p className="employee-workplace__location-desc">{location.description}</p>
              ) : null}
            </>
          ) : (
            <>
              <p className="employee-workplace__location-name employee-workplace__location-name--muted">
                {t("employee.assignment.noLocationTitle")}
              </p>
              <p className="employee-workplace__location-desc">{t("employee.assignment.noLocationDesc")}</p>
            </>
          )}
        </section>

        {/* Assigned tables */}
        <section className="employee-workplace__tables" aria-labelledby="employee-workplace-tables-heading">
          <div className="employee-workplace__tables-head">
            <h3 id="employee-workplace-tables-heading" className="employee-workplace__tables-title">
              {t("employee.assignment.tablesTitle")}
              {!booting && tables.length > 0 ? (
                <span className="employee-workplace__count">{tables.length}</span>
              ) : null}
            </h3>
            <p className="employee-workplace__tables-hint">{t("employee.assignment.tablesHint")}</p>
          </div>

          {booting ? (
            <div className="employee-workplace__tiles" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <span key={i} className="employee-workplace__skeleton employee-workplace__skeleton--tile" />
              ))}
            </div>
          ) : tables.length === 0 ? (
            <div className="employee-workplace__empty">
              <span className="employee-workplace__empty-icon" aria-hidden="true">
                <Utensils className="h-5 w-5" />
              </span>
              <p className="employee-workplace__empty-title">{t("employee.assignment.noTablesTitle")}</p>
              <p className="employee-workplace__empty-desc">{t("employee.assignment.noTablesDesc")}</p>
            </div>
          ) : (
            <ul className="employee-workplace__tiles" role="list">
              {tables.map((table) => {
                // The business keeps every table inside the assigned location; if older data differs,
                // show the table's own location name rather than implying it is at the assigned one.
                const otherLocation =
                  table.location.id !== location?.id ? table.location.name : null;
                return (
                  <li key={table.id} className="employee-workplace__tile">
                    <span className="employee-workplace__tile-icon" aria-hidden="true">
                      <Utensils className="h-4 w-4" />
                    </span>
                    <span className="employee-workplace__tile-text">
                      <span className="employee-workplace__tile-name">{table.name}</span>
                      {otherLocation ? (
                        <span className="employee-workplace__tile-location">{otherLocation}</span>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          <p className="employee-workplace__note">
            <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{t("employee.assignment.managedNote")}</span>
          </p>
        </section>
      </div>
    </div>
  );
}
