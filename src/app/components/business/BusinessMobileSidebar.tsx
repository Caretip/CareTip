import { useSyncExternalStore } from "react";
import { Loader2, X } from "lucide-react";
import { CareIcon } from "@/components/icons";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../hooks/useAuth";
import {
  isAuthLogoutTransitionActive,
  subscribeAuthLogoutTransition,
} from "../../lib/authLogoutTransition";
import { cn } from "@/lib/utils";
import {
  CareTipLogo,
  DASHBOARD_SIDEBAR_MOBILE_BRAND_CLASS,
  DASHBOARD_SIDEBAR_NAV_CLASS,
} from "../CareTipLogo";
import { BusinessSidebarNavShell } from "./sidebar/BusinessSidebarNavShell";
import { BusinessSidebarUpgradeCta } from "./sidebar/BusinessSidebarUpgradeCta";
import { useBusinessGuidelines } from "@/app/contexts/BusinessGuidelinesContext";
import { MobileDrawer } from "../ui/MobileDrawer";
import { dashboardSidebarIconButtonIdle, dashboardSidebarSignOutButton } from "@/lib/theme/dashboardSidebarUi";
import { Rocket } from "lucide-react";

interface BusinessMobileSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export function BusinessMobileSidebar({ isOpen, onClose }: BusinessMobileSidebarProps) {
  const { t } = useTranslation();
  const { user, logout, exitImpersonation } = useAuth();
  const { openGuidelines } = useBusinessGuidelines();
  const signingOut = useSyncExternalStore(
    subscribeAuthLogoutTransition,
    isAuthLogoutTransitionActive,
    () => false,
  );

  return (
    <MobileDrawer isOpen={isOpen} onClose={onClose} ariaLabel={t("shell.header.menuButtonAria")}>
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

      <nav
        className={cn(
          DASHBOARD_SIDEBAR_NAV_CLASS,
          "min-h-0 flex-1 overflow-y-auto overscroll-contain px-0",
        )}
      >
        <BusinessSidebarNavShell onNavigate={onClose} />
      </nav>

      <div className="shrink-0 border-t border-sidebar-border px-3 pt-2 pb-4">
        <BusinessSidebarUpgradeCta />
        <button
          type="button"
          onClick={() => {
            openGuidelines();
            onClose();
          }}
          className={cn(dashboardSidebarSignOutButton, "mb-1")}
        >
          <Rocket className="h-[1.125rem] w-[1.125rem] shrink-0 opacity-90" aria-hidden />
          <span className="text-sm font-medium">{t("business.dashboard.quickStartNavLabel")}</span>
        </button>
        <button
          type="button"
          disabled={signingOut}
          aria-busy={signingOut}
          onClick={() => {
            if (signingOut) return;
            if (user?.impersonation) {
              void exitImpersonation();
              onClose();
              return;
            }
            logout();
            onClose();
          }}
          className={dashboardSidebarSignOutButton}
        >
          <CareIcon name="signOut" size="md" />
          {signingOut ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
          ) : null}
          <span className="text-sm font-medium">{t("dashboard.signOut")}</span>
        </button>
      </div>
    </MobileDrawer>
  );
}
