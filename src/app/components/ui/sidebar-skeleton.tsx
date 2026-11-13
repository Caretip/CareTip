import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  DASHBOARD_SIDEBAR_BRAND_CLASS,
  DASHBOARD_SIDEBAR_NAV_CLASS,
} from "@/app/components/CareTipLogo";
import { DASHBOARD_SIDEBAR_SHELL_CLASS } from "@/lib/theme/dashboardSidebarUi";

type SidebarSkeletonProps = {
  className?: string;
  /** Desktop fixed sidebar (lg+) vs mobile sheet drawer. */
  variant?: "desktop" | "mobile";
};

export function SidebarSkeleton({ className, variant = "desktop" }: SidebarSkeletonProps) {
  const { t } = useTranslation();
  const shell =
    variant === "desktop"
      ? cn(DASHBOARD_SIDEBAR_SHELL_CLASS, "hidden lg:fixed lg:inset-y-0 lg:z-40 lg:flex lg:w-64 lg:flex-col")
      : "flex w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground";

  return (
    <aside className={cn(shell, className)} aria-label={t("common.a11y.loadingNavigation")} aria-busy="true">
      <div className={DASHBOARD_SIDEBAR_BRAND_CLASS}>
        <div
          className={cn(
            "rounded-md bg-muted animate-pulse",
            variant === "desktop" ? "h-[45px] w-[120px]" : "h-9 w-[96px]",
          )}
        />
      </div>

      <nav className={cn(DASHBOARD_SIDEBAR_NAV_CLASS, variant === "desktop" ? "" : "px-4")}>
        <ul className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <li key={i} className="flex items-center gap-3 rounded-lg px-3 py-2.5">
              <div className="h-5 w-5 rounded bg-muted animate-pulse" />
              <div className="h-3 w-28 rounded bg-muted animate-pulse" />
            </li>
          ))}
        </ul>
      </nav>

      <div className="border-t border-sidebar-border p-4">
        <div className="flex items-center gap-3 rounded-lg px-3 py-2.5">
          <div className="h-9 w-9 rounded-full bg-muted animate-pulse" />
          <div className="min-w-0 flex-1">
            <div className="h-3 w-24 rounded bg-muted animate-pulse" />
            <div className="mt-2 h-2.5 w-32 rounded bg-muted animate-pulse" />
          </div>
        </div>
      </div>
    </aside>
  );
}

