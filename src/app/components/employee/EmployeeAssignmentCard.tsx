import { MapPin, UtensilsCrossed } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EmployeeSelfAssignment } from "../../lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmployeeEmptyState } from "./EmployeeEmptyState";
import { employeeUi } from "./employeeDashboardUi";
import { cn } from "@/lib/utils";

type Props = {
  assignment: EmployeeSelfAssignment | undefined;
  loading?: boolean;
  /** When false, omit the card title block (page header already provides it). */
  showHeader?: boolean;
};

export function EmployeeAssignmentCard({ assignment, loading, showHeader = true }: Props) {
  const { t } = useTranslation();
  const location = assignment?.location ?? null;
  const tables = assignment?.tables ?? [];
  const hasLocation = Boolean(location);
  const hasTables = tables.length > 0;

  return (
    <Card
      className={cn(
        employeeUi.card,
        "w-full rounded-2xl",
        !showHeader && "dashboard-mobile-flat-surface",
      )}
      aria-busy={loading || undefined}
    >
      {showHeader ? (
        <CardHeader className="pb-3">
          <div className="flex items-start gap-3">
            <div className={employeeUi.iconTile} aria-hidden>
              <MapPin className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <CardTitle className="text-base">{t("employee.assignment.title")}</CardTitle>
              <CardDescription className="mt-1">{t("employee.assignment.subtitle")}</CardDescription>
            </div>
          </div>
        </CardHeader>
      ) : null}
      <CardContent className={cn("space-y-5", showHeader ? "pt-0" : "pt-5")}>
        <section aria-labelledby="employee-assignment-location-heading">
          <h3
            id="employee-assignment-location-heading"
            className="text-sm font-semibold tracking-tight text-foreground"
          >
            {t("employee.assignment.locationLabel")}
          </h3>
          {loading && assignment === undefined ? (
            <p className="mt-2 text-sm text-muted-foreground">{t("employee.assignment.loading")}</p>
          ) : hasLocation && location ? (
            <div className="mt-2 space-y-1">
              <p className="text-sm font-medium text-foreground">{location.name}</p>
              {location.description ? (
                <p className="text-sm leading-relaxed text-muted-foreground">{location.description}</p>
              ) : null}
            </div>
          ) : (
            <EmployeeEmptyState
              compact
              className="mt-2 !py-6"
              title={t("employee.assignment.noLocationTitle")}
              description={t("employee.assignment.noLocationDesc")}
            />
          )}
        </section>

        <section aria-labelledby="employee-assignment-tables-heading">
          <h3
            id="employee-assignment-tables-heading"
            className="text-sm font-semibold tracking-tight text-foreground"
          >
            {t("employee.assignment.tablesLabel")}
          </h3>
          {loading && assignment === undefined ? (
            <p className="mt-2 text-sm text-muted-foreground">{t("employee.assignment.loading")}</p>
          ) : hasTables ? (
            <ul className="mt-2 space-y-2">
              {tables.map((table) => (
                <li
                  key={table.id}
                  className={cn(
                    employeeUi.listItem,
                    "dashboard-mobile-list-row flex items-start gap-3 px-3 py-3 sm:px-4 max-lg:dashboard-mobile-list-row--flat max-lg:px-0",
                  )}
                >
                  <UtensilsCrossed
                    className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{table.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("employee.assignment.tableAtLocation", { location: table.location.name })}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmployeeEmptyState
              compact
              className="mt-2 !py-6"
              title={t("employee.assignment.noTablesTitle")}
              description={t("employee.assignment.noTablesDesc")}
            />
          )}
        </section>
      </CardContent>
    </Card>
  );
}
