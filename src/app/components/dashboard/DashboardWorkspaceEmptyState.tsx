import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { dashboardWorkspaceUi } from "./dashboardWorkspaceUi";

export type DashboardWorkspaceEmptyStateProps = {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
};

export function DashboardWorkspaceEmptyState({
  icon,
  title,
  description,
  action,
  className,
  compact = false,
}: DashboardWorkspaceEmptyStateProps) {
  return (
    <div
      className={cn(
        compact
          ? "dashboard-workspace-empty dashboard-workspace-empty--compact flex flex-col items-start text-left"
          : cn(dashboardWorkspaceUi.card, "dashboard-workspace-empty flex flex-col items-center text-center"),
        compact ? "px-0 py-3 sm:py-4" : "px-4 py-10 sm:px-6 sm:py-12",
        className,
      )}
      role="status"
    >
      {icon ? (
        <div
          className={cn(
            "flex items-center justify-center text-muted-foreground",
            compact
              ? "mb-1 h-8 w-8 rounded-md bg-muted/40"
              : "h-10 w-10 rounded-lg border border-border bg-muted/30",
          )}
        >
          {icon}
        </div>
      ) : null}
      <p
        className={cn(
          compact ? "text-sm font-medium text-foreground" : dashboardWorkspaceUi.subsectionTitle,
          icon && !compact ? "mt-4" : icon && compact ? "mt-0" : "",
        )}
      >
        {title}
      </p>
      {description ? (
        <p
          className={cn(
            compact
              ? "mt-1 max-w-prose text-xs leading-relaxed text-muted-foreground sm:text-sm"
              : cn(dashboardWorkspaceUi.helperText, "mt-1.5 max-w-sm"),
          )}
        >
          {description}
        </p>
      ) : null}
      {action ? <div className={cn(compact ? "mt-3" : "mt-4")}>{action}</div> : null}
    </div>
  );
}
