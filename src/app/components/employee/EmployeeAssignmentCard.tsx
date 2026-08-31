import { UtensilsCrossed } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EmployeeSelfAssignment } from "../../lib/api";
import { EmployeeEmptyState } from "./EmployeeEmptyState";
import { cn } from "@/lib/utils";

type Props = {
  assignment: EmployeeSelfAssignment | undefined;
  loading?: boolean;
  /** When false, omit the page title block (page header already provides it). */
  showHeader?: boolean;
};

export function EmployeeAssignmentCard({ assignment, loading, showHeader = true }: Props) {
  const { t } = useTranslation();
  const location = assignment?.location ?? null;
  const tables = assignment?.tables ?? [];
  const hasLocation = Boolean(location);
  const hasTables = tables.length > 0;

  return (
    <div className="employee-assignment-panel w-full min-w-0" aria-busy={loading || undefined}>
      {showHeader ? (
        <div className="employee-assignment-panel__intro mb-5">
          <h2 className="text-lg font-semibold tracking-tight text-foreground sm:text-xl">
            {t("employee.assignment.title")}
          </h2>
          {t("employee.assignment.subtitle").trim() ? (
            <p className="mt-1 text-sm text-muted-foreground">{t("employee.assignment.subtitle")}</p>
          ) : null}
        </div>
      ) : null}

      <div className="employee-assignment-panel__body space-y-4 sm:space-y-6">
        <section aria-labelledby="employee-assignment-location-heading">
          <h3 id="employee-assignment-location-heading" className="employee-assignment-panel__label">
            {t("employee.assignment.locationLabel")}
          </h3>
          {loading && assignment === undefined ? (
            <p className="mt-2 text-sm text-muted-foreground">{t("employee.assignment.loading")}</p>
          ) : hasLocation && location ? (
            <div className="mt-2 space-y-1">
              <p className="text-base font-semibold leading-snug text-foreground">{location.name}</p>
              {location.description ? (
                <p className="text-sm leading-relaxed text-muted-foreground">{location.description}</p>
              ) : null}
            </div>
          ) : (
            <EmployeeEmptyState
              compact
              className="mt-1.5 !py-2.5"
              title={t("employee.assignment.noLocationTitle")}
              description={t("employee.assignment.noLocationDesc")}
            />
          )}
        </section>

        <div className="employee-assignment-panel__divider border-t border-border/60" role="separator" />

        <section aria-labelledby="employee-assignment-tables-heading">
          <h3 id="employee-assignment-tables-heading" className="employee-assignment-panel__label">
            {t("employee.assignment.tablesLabel")}
          </h3>
          {loading && assignment === undefined ? (
            <p className="mt-2 text-sm text-muted-foreground">{t("employee.assignment.loading")}</p>
          ) : hasTables ? (
            <ul className="employee-assignment-panel__table-list mt-1 divide-y divide-border/60" role="list">
              {tables.map((table) => (
                <li
                  key={table.id}
                  className="flex items-start gap-2.5 py-2.5 first:pt-2 last:pb-0 sm:gap-3 sm:py-3"
                >
                  <UtensilsCrossed
                    className="mt-0.5 h-4 w-4 shrink-0 text-[var(--caretip-brand-orange,#e9781c)]"
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold leading-snug text-foreground sm:text-[0.9375rem]">
                      {table.name}
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground sm:text-sm">
                      {table.location.name}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmployeeEmptyState
              compact
              className="mt-1.5 !py-2.5"
              title={t("employee.assignment.noTablesTitle")}
              description={t("employee.assignment.noTablesDesc")}
            />
          )}
        </section>
      </div>
    </div>
  );
}
