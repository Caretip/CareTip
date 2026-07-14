import { Link, useLocation } from "react-router";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../hooks/useAuth";
import { cn } from "@/lib/utils";
import { CareTipLogo, DASHBOARD_SIDEBAR_MOBILE_BRAND_CLASS, DASHBOARD_SIDEBAR_NAV_CLASS } from "./CareTipLogo";
import { CareIcon } from "@/components/icons";
import { dashboardShellNavItems } from "./dashboardShellNav";
import { MobileDrawer } from "./ui/MobileDrawer";
import { dashboardSidebarIconButtonIdle } from "@/lib/theme/dashboardSidebarUi";

interface DashboardMobileSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export function DashboardMobileSidebar({ isOpen, onClose }: DashboardMobileSidebarProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const { user } = useAuth();

  const initial =
    user?.name
      ?.split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("") || "U";

  return (
    <MobileDrawer isOpen={isOpen} onClose={onClose}>
      <div className={DASHBOARD_SIDEBAR_MOBILE_BRAND_CLASS}>
        <div className="min-w-0 flex-1">
          <CareTipLogo size="drawer" />
        </div>
        <button
          type="button"
          onClick={onClose}
          className={cn(
            "touch-manipulation inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl p-2.5",
            dashboardSidebarIconButtonIdle,
          )}
        >
          <X className="h-5 w-5 text-sidebar-foreground" />
        </button>
      </div>

      <nav className={cn(DASHBOARD_SIDEBAR_NAV_CLASS, "px-4")}>
        <ul className="space-y-1">
          {dashboardShellNavItems.map((item) => {
            const isActive = location.pathname === item.href;
            return (
              <li key={item.href}>
                <Link
                  to={item.href}
                  onClick={onClose}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors",
                    isActive
                      ? "admin-dash-nav-link--active font-semibold text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    "admin-dash-nav-link",
                  )}
                >
                  <CareIcon name={item.icon} size="md" />
                  <span className="min-w-0 truncate text-sm font-medium">{t(item.labelKey)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="shrink-0 border-t border-sidebar-border p-4">
        <Link
          to="/dashboard/settings"
          onClick={onClose}
          className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary font-medium text-primary-foreground">
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">
              {user?.name || t("dashboard.managerFallback")}
            </p>
            <p className="truncate text-xs text-muted-foreground">{user?.email || ""}</p>
          </div>
        </Link>
      </div>
    </MobileDrawer>
  );
}
