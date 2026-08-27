import { memo } from "react";
import { cn } from "@/lib/utils";
import type { DashboardStatusTone } from "@/app/lib/dashboardStatus/types";

const textClass: Record<DashboardStatusTone, string> = {
  live: "text-foreground",
  updating: "text-foreground",
  action: "text-foreground",
};

const dotClass: Record<DashboardStatusTone, string> = {
  live: "bg-emerald-500",
  updating: "bg-amber-500 animate-pulse",
  action: "bg-red-500",
};

export type DashboardStatusBadgeProps = {
  tone: DashboardStatusTone;
  label: string;
  description?: string;
  className?: string;
};

export const DashboardStatusBadge = memo(function DashboardStatusBadge({
  tone,
  label,
  description,
  className,
}: DashboardStatusBadgeProps) {
  const live = tone === "live";

  return (
    <span
      role="status"
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 text-xs font-medium",
        textClass[tone],
        className,
      )}
      title={description}
    >
      <span
        className={cn(
          "relative inline-flex h-2.5 w-2.5 shrink-0 items-center justify-center",
          !live && "h-2 w-2",
        )}
        aria-hidden
      >
        {live ? (
          <>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-40" />
            <span className={cn("inline-flex h-2 w-2 rounded-full", dotClass.live)} />
          </>
        ) : (
          <span className={cn("h-2 w-2 rounded-full", dotClass[tone])} />
        )}
      </span>
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
});
