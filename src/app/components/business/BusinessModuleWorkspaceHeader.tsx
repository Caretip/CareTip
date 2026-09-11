import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { HeroPersonality } from "@/lib/heroPersonalitySystem";
import { dashboardWorkspaceUi } from "@/app/components/dashboard/dashboardWorkspaceUi";
import { cn } from "@/lib/utils";

type BusinessModuleWorkspaceHeaderProps = {
  badge: string;
  feature?: ReactNode;
  icon: LucideIcon;
  title: string;
  subtitle: string;
  className?: string;
  actions?: ReactNode;
  /** Align header actions with the title block’s bottom edge (SaaS page-header rhythm). */
  actionsAlign?: "start" | "end";
  actionsClassName?: string;
  /** @deprecated Decorative personalities removed — kept for API compatibility. */
  personality?: HeroPersonality;
  statusBadge?: ReactNode;
  insightBadge?: ReactNode;
  premiumIndicator?: ReactNode;
  /** When true, module subtitle is hidden below lg (card/page body carries the one-line summary). */
  hideSubtitleOnMobile?: boolean;
};

/** Flat module page header — typography hierarchy only. */
export function BusinessModuleWorkspaceHeader({
  badge,
  feature,
  icon: _Icon,
  title,
  subtitle,
  className,
  actions,
  actionsAlign = "start",
  actionsClassName,
  statusBadge,
  insightBadge,
  premiumIndicator,
  hideSubtitleOnMobile = false,
}: BusinessModuleWorkspaceHeaderProps) {
  const metaPills = [feature, statusBadge, insightBadge, premiumIndicator].filter(Boolean);

  return (
    <header
      className={cn(
        dashboardWorkspaceUi.moduleHeader,
        "business-module-workspace-header premium-workspace-header",
        hideSubtitleOnMobile && "business-module-workspace-header--hide-mobile-desc",
        className,
      )}
    >
      <div
        className={cn(
          dashboardWorkspaceUi.moduleHeaderRow,
          actions && actionsAlign === "end" && "sm:items-end",
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className={dashboardWorkspaceUi.eyebrow}>{badge}</span>
            {metaPills.map((pill, index) => (
              <span key={index} className="text-xs text-muted-foreground">
                {pill}
              </span>
            ))}
          </div>
          <h1 className={dashboardWorkspaceUi.pageTitle}>{title}</h1>
          {subtitle.trim() ? (
            <p className={dashboardWorkspaceUi.pageDescription}>{subtitle}</p>
          ) : null}
        </div>

        {actions ? (
          <div
            className={cn(
              "flex shrink-0 flex-wrap items-center gap-2",
              actionsAlign === "end" && "w-full sm:w-auto sm:justify-end",
              actionsClassName,
            )}
          >
            {actions}
          </div>
        ) : null}
      </div>
    </header>
  );
}
