import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { businessUi } from "@/app/components/business/businessDashboardUi";
import { dashboardWorkspaceUi } from "@/app/components/dashboard/dashboardWorkspaceUi";

export function BusinessSettingsPanelShell({
  title,
  description,
  children,
  className,
  /** Page already provides title — render form only. */
  embedded = false,
  /** Subgroup card with optional title (e.g. password, 2FA). */
  grouped = false,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
  embedded?: boolean;
  grouped?: boolean;
}) {
  if (embedded) {
    return <div className={cn("space-y-5", className)}>{children}</div>;
  }

  const showHeader = Boolean(title || description);

  return (
    <section
      className={cn(
        grouped ? "business-card business-card--tool p-5 sm:p-6" : businessUi.settingsSection,
        !grouped && businessUi.settingsPanel,
        className,
      )}
    >
      {showHeader ? (
        <header className={cn(showHeader && "mb-5", grouped && "border-b border-border pb-4")}>
          {title ? <h2 className={dashboardWorkspaceUi.sectionTitle}>{title}</h2> : null}
          {description ? (
            <p className={cn(title ? "mt-1.5" : "", "max-w-2xl", dashboardWorkspaceUi.helperText)}>
              {description}
            </p>
          ) : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}
