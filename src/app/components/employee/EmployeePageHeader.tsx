import type { ReactNode } from "react";
import { Link } from "react-router";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { employeeUi } from "./employeeDashboardUi";

type EmployeePageHeaderProps = {
  title: string;
  description?: string;
  backTo?: string;
  backAriaLabel?: string;
  /** Compact text back link — less visual weight than the default button. */
  backVariant?: "default" | "subtle";
  actions?: ReactNode;
  leading?: ReactNode;
  className?: string;
};

export function EmployeePageHeader({
  title,
  description,
  backTo = "/employee/dashboard",
  backAriaLabel = "Back",
  backVariant = "default",
  actions,
  leading,
  className,
}: EmployeePageHeaderProps) {
  const subtle = backVariant === "subtle";

  return (
    <header
      className={cn(
        employeeUi.pageHeader,
        subtle && "employee-page-header--subtle",
        className,
      )}
    >
      <div
        className={cn(
          employeeUi.pageHeaderInner,
          subtle && "flex-col gap-2 sm:flex-col sm:items-stretch",
        )}
      >
        {subtle ? (
          <>
            <Link
              to={backTo}
              className="employee-page-header__back employee-page-header__back--subtle inline-flex w-fit items-center gap-0.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden />
              <span>{backAriaLabel}</span>
            </Link>
            <div className="min-w-0">
              {leading ? <div className="mb-2 shrink-0">{leading}</div> : null}
              <h1 className={employeeUi.pageTitle}>{title}</h1>
              {description ? <p className={employeeUi.pageDesc}>{description}</p> : null}
            </div>
            {actions ? (
              <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
            ) : null}
          </>
        ) : (
          <>
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <Link
                to={backTo}
                className="employee-page-header__back mt-0.5 inline-flex shrink-0 items-center justify-center rounded-xl border border-border/60 bg-card/80 px-3 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted/50"
              >
                {backAriaLabel}
              </Link>
              {leading ? <div className="shrink-0">{leading}</div> : null}
              <div className="min-w-0 flex-1">
                <h1 className={employeeUi.pageTitle}>{title}</h1>
                {description ? <p className={employeeUi.pageDesc}>{description}</p> : null}
              </div>
            </div>
            {actions ? (
              <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
            ) : null}
          </>
        )}
      </div>
    </header>
  );
}
