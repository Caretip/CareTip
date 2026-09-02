import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useDashboardShellAria } from "@/app/hooks/useDashboardShellAria";
import { cn } from "@/lib/utils";
import { DASHBOARD_METRIC_STAT_CARD_SHELL } from "./dashboardMetricTokens";
import { LoadingSpinner } from "@/app/components/ui/loading-spinner";

export { DashboardStableChartSlot } from "./DashboardStableChartSlot";
export {
  TipsActivityTableSkeleton,
  NotificationInboxListSkeleton,
  NotificationPreviewListSkeleton,
  LocationCardGridSkeleton,
  LocationTablesWorkspaceSkeleton,
  TablesListSkeleton,
  GlobalTransactionsTableSkeleton,
  StaffRosterTableSkeleton,
  PlatformAdminTableSkeleton,
  EmployeeGoalListSkeleton,
  EmployeeSettingsFormSkeleton,
} from "./DashboardContentSkeletons";

/** Compact spinner for inline labels and section headers. */
export function InlineSpinner({ className }: { className?: string }) {
  return (
    <LoadingSpinner
      size="sm"
      className={cn("!h-3.5 !w-3.5 shrink-0 border-[1.5px] text-primary/70", className)}
      aria-hidden
    />
  );
}

/** Spinner + label for chart, goals, and analytics panels. */
export function AnalyticsLoadingState({
  label,
  className,
  minHeightClass = "min-h-[220px] sm:min-h-[260px]",
  ariaLabel,
}: {
  label: string;
  className?: string;
  minHeightClass?: string;
  ariaLabel?: string;
}) {
  return (
    <div
      className={cn(
        "flex w-full flex-col items-center justify-center gap-2.5",
        minHeightClass,
        className,
      )}
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label={ariaLabel ?? label}
    >
      <LoadingSpinner size="sm" className="text-primary/70" />
      <p className="text-center text-xs font-medium tracking-wide text-muted-foreground/80">{label}</p>
    </div>
  );
}

/** Reserved panel region — preserves card height during fetch. */
export function SectionLoader({
  label,
  className,
  minHeightClass = "min-h-[220px] sm:min-h-[260px]",
}: {
  label?: string;
  className?: string;
  minHeightClass?: string;
}) {
  return (
    <AnalyticsLoadingState
      label={label ?? ""}
      className={className}
      minHeightClass={minHeightClass}
      ariaLabel={label}
    />
  );
}

/** Soft opacity reveal when section data is ready (no layout jump). */
export function DeferredContentFade({
  show,
  children,
  className,
}: {
  show: boolean;
  children: ReactNode;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      initial={false}
      animate={{ opacity: show ? 1 : 0 }}
      transition={{
        duration: reduceMotion ? 0 : 0.32,
        ease: [0.22, 1, 0.36, 1],
      }}
      className={cn(
        "transition-[opacity] duration-300",
        !show && "pointer-events-none",
        className,
      )}
      aria-hidden={!show ? true : undefined}
    >
      {children}
    </motion.div>
  );
}

/** Employee goals table shell — keeps header + height while goals sync. */
export function GoalsTableLoadingShell({
  label,
  columnLabels,
  className,
}: {
  label: string;
  columnLabels: string[];
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 overflow-x-auto", className)} aria-busy="true" aria-live="polite">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            {columnLabels.map((col) => (
              <th key={col} className="pb-2 pr-3 font-medium">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={columnLabels.length} className="pt-3">
              <div className="space-y-2.5" role="status" aria-busy="true" aria-label={label}>
                {[0, 1, 2, 3].map((row) => (
                  <div key={row} className="flex gap-3 py-1">
                    <span className="dashboard-hero-metric-skeleton__bar h-4 w-[28%] max-w-[9rem] rounded-md" aria-hidden />
                    <span className="dashboard-hero-metric-skeleton__bar h-4 w-[18%] max-w-[5rem] rounded-md" aria-hidden />
                    <span className="dashboard-hero-metric-skeleton__bar h-4 w-[14%] max-w-[4rem] rounded-md" aria-hidden />
                    <span className="dashboard-hero-metric-skeleton__bar h-4 w-[12%] max-w-[3.5rem] rounded-md" aria-hidden />
                  </div>
                ))}
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** KPI grid placeholder for route-level dashboard outlet fallback (skeleton-first). */
export function DashboardMetricsGridSkeleton({
  cards = 4,
  className,
}: {
  cards?: number;
  className?: string;
}) {
  const aria = useDashboardShellAria();

  return (
    <div
      className={cn(
        "mx-auto grid w-full max-w-5xl grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4",
        className,
      )}
      role="status"
      aria-busy="true"
      aria-label={aria.loading}
    >
      {Array.from({ length: cards }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "dashboard-metric-stat-card dashboard-metrics-grid-skeleton__card",
            DASHBOARD_METRIC_STAT_CARD_SHELL,
          )}
        >
          <span className="dashboard-hero-metric-skeleton__bar h-3 w-[58%] max-w-[9rem]" aria-hidden />
          <span className="dashboard-hero-metric-skeleton__bar h-7 w-[72%] max-w-[11rem]" aria-hidden />
          <span className="dashboard-hero-metric-skeleton__bar mt-auto h-2.5 w-[48%] max-w-[7rem]" aria-hidden />
        </div>
      ))}
    </div>
  );
}

/** Compact list rows for secondary panels (top performers, etc.). */
export function DashboardListSkeleton({
  rows = 3,
  className,
  minHeightClass = "min-h-[160px] sm:min-h-[180px]",
}: {
  rows?: number;
  className?: string;
  minHeightClass?: string;
}) {
  const aria = useDashboardShellAria();

  return (
    <div
      className={cn("space-y-3", minHeightClass, className)}
      role="status"
      aria-busy="true"
      aria-label={aria.loading}
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 py-1">
          <span className="dashboard-hero-metric-skeleton__bar h-9 w-9 shrink-0 rounded-full" aria-hidden />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="dashboard-hero-metric-skeleton__bar h-3.5 w-[42%] max-w-[10rem] rounded-md" aria-hidden />
            <span className="dashboard-hero-metric-skeleton__bar h-2.5 w-[28%] max-w-[6rem] rounded-md" aria-hidden />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Subtle coordinated-loading hint below analytics period controls. */
export function DashboardAnalyticsPhaseHint({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 text-xs font-medium text-muted-foreground/85",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <span
        className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-muted-foreground/50"
        aria-hidden
      />
      <span>{label}</span>
    </div>
  );
}

/** Reserves hint row height only while the secondary phase hint is visible. */
export function DashboardAnalyticsPhaseHintSlot({
  show,
  label,
  className,
}: {
  show: boolean;
  label: string;
  className?: string;
}) {
  if (!show) return null;

  return (
    <div className={cn("min-h-[1.375rem]", className)}>
      <DashboardAnalyticsPhaseHint label={label} />
    </div>
  );
}
