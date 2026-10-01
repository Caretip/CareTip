import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { dashboardWorkspaceUi } from "@/app/components/dashboard/dashboardWorkspaceUi";
import { platformUi } from "./platformDashboardUi";

/** Open section — typography + divider, not a card. */
export function PlatformAdminSection({
  title,
  description,
  actions,
  children,
  className,
  id,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("platform-admin-section", className)} aria-labelledby={title ? `${id ?? "section"}-title` : undefined}>
      {(title || actions) && (
        <div className="platform-admin-section__head mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            {title ? (
              <h2 id={`${id ?? "section"}-title`} className={dashboardWorkspaceUi.sectionTitle}>
                {title}
              </h2>
            ) : null}
            {description ? <p className={cn(dashboardWorkspaceUi.pageDescription, "mt-1")}>{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      )}
      {children}
    </section>
  );
}

/** Horizontal KPI strip (overview + module summaries). */
export function PlatformAdminMetricStrip({
  children,
  className,
  "aria-label": ariaLabel,
}: {
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <div className={cn(platformUi.metricStrip, className)} role="list" aria-label={ariaLabel}>
      {children}
    </div>
  );
}

export function PlatformAdminFilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn(platformUi.filterBar, className)}>{children}</div>;
}

export function PlatformAdminEmptyBlock({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(platformUi.emptyBlock, className)}>
      <p className={dashboardWorkspaceUi.emptyTitle}>{title}</p>
      {description ? <p className={cn(dashboardWorkspaceUi.emptyDesc, "mt-1")}>{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
