import { motion } from "motion/react";
import { memo, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { CareIcon } from "@/components/icons";
import { useAuth } from "../../hooks/useAuth";
import {
  isAuthLogoutTransitionActive,
  subscribeAuthLogoutTransition,
} from "../../lib/authLogoutTransition";
import { CareTipLogo, DASHBOARD_SIDEBAR_BRAND_CLASS, DASHBOARD_SIDEBAR_NAV_CLASS } from "../CareTipLogo";
import { BusinessSidebarNavShell } from "./sidebar/BusinessSidebarNavShell";
import { BusinessSidebarUpgradeCta } from "./sidebar/BusinessSidebarUpgradeCta";
import { useBusinessGuidelines } from "@/app/contexts/BusinessGuidelinesContext";
import { DASHBOARD_SIDEBAR_SHELL_CLASS, dashboardSidebarSignOutButton } from "@/lib/theme/dashboardSidebarUi";
import { cn } from "@/lib/utils";
import { Rocket } from "lucide-react";
import { useDashboardRenderProbe } from "../../hooks/useDashboardRuntimeProfile";

export const BusinessSidebar = memo(function BusinessSidebar() {
  useDashboardRenderProbe("business:BusinessSidebar");
  const { t } = useTranslation();
  const { user, logout, exitImpersonation } = useAuth();
  const { openGuidelines } = useBusinessGuidelines();
  const signingOut = useSyncExternalStore(
    subscribeAuthLogoutTransition,
    isAuthLogoutTransitionActive,
    () => false,
  );

  return (
    <motion.aside
      initial={{ x: -20, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.5 }}
      className={cn("business-sidebar", DASHBOARD_SIDEBAR_SHELL_CLASS)}
    >
      <div className={DASHBOARD_SIDEBAR_BRAND_CLASS}>
        <CareTipLogo size="sidebar" />
      </div>

      <nav className={cn(DASHBOARD_SIDEBAR_NAV_CLASS, "min-h-0 flex-1 overflow-y-auto overscroll-contain px-0")}>
        <BusinessSidebarNavShell />
      </nav>

      <div className="mt-auto shrink-0 border-t border-sidebar-border px-3 pt-2 pb-4">
        <BusinessSidebarUpgradeCta />
        <button
          type="button"
          onClick={openGuidelines}
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
              return;
            }
            logout();
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
    </motion.aside>
  );
});
