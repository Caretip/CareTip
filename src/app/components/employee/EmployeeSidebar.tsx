import { motion } from "motion/react";
import { memo, useSyncExternalStore } from "react";
import { Link } from "react-router";
import { Loader2 } from "lucide-react";
import { CareIcon } from "@/components/icons";
import { useTranslation } from "react-i18next";

import { useAuth } from "../../hooks/useAuth";
import { useEmployeeEntitlementsContext } from "../../contexts/EmployeeEntitlementsContext";
import { useSubscriptionEntitlements } from "../../hooks/useSubscriptionEntitlements";
import {
  isAuthLogoutTransitionActive,
  subscribeAuthLogoutTransition,
} from "../../lib/authLogoutTransition";
import { cn } from "@/lib/utils";
import {
  DASHBOARD_SIDEBAR_BRAND_CLASS,
  DASHBOARD_SIDEBAR_NAV_CLASS,
} from "../CareTipLogo";
import { BusinessLogoMark } from "../business/BusinessLogoMark";
import { EMPLOYEE_DASHBOARD_HOME } from "./employeeDashboardNav";
import { EmployeeSidebarNav } from "./EmployeeSidebarNav";
import { useDashboardRenderProbe } from "../../hooks/useDashboardRuntimeProfile";
import {
  DASHBOARD_SIDEBAR_SHELL_CLASS,
  dashboardSidebarSignOutButton,
} from "@/lib/theme/dashboardSidebarUi";

type EmployeeBusinessBranding = {
  businessLogo: string | null;
  businessName: string;
};

export const EmployeeSidebar = memo(function EmployeeSidebar({
  businessBranding,
}: {
  businessBranding?: EmployeeBusinessBranding | null;
}) {
  useDashboardRenderProbe("employee:EmployeeSidebar");
  const { t } = useTranslation();
  const { logout, user } = useAuth();
  const signingOut = useSyncExternalStore(
    subscribeAuthLogoutTransition,
    isAuthLogoutTransitionActive,
    () => false,
  );
  const employeeEntitlements = useEmployeeEntitlementsContext();
  const fallbackEntitlements = useSubscriptionEntitlements({
    enabled: user?.role === "employee" && employeeEntitlements == null,
    role: user?.role === "employee" ? "employee" : null,
  });
  const { tier, ready: entitlementsReady } = employeeEntitlements ?? fallbackEntitlements;

  const venueName =
    String(businessBranding?.businessName ?? "").trim() || t("dashboard.venueDashboardFallback");

  return (
    <motion.aside
      initial={{ x: -20, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.5 }}
      className={cn("employee-sidebar", DASHBOARD_SIDEBAR_SHELL_CLASS)}
    >
      <div className={DASHBOARD_SIDEBAR_BRAND_CLASS}>
        <Link
          to={EMPLOYEE_DASHBOARD_HOME}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg outline-none ring-sidebar-ring transition-colors hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
        >
          <BusinessLogoMark
            logoPathOrUrl={businessBranding?.businessLogo ?? null}
            businessName={venueName}
            size="dashboard"
            className="shrink-0"
          />
          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-sidebar-foreground">
            {venueName}
          </p>
        </Link>
      </div>

      <nav className={DASHBOARD_SIDEBAR_NAV_CLASS}>
        <EmployeeSidebarNav entitlementsReady={entitlementsReady} tier={tier} />
      </nav>

      <div className="mt-auto shrink-0 border-t border-sidebar-border px-4 pb-4 pt-3">
        <button
          type="button"
          disabled={signingOut}
          aria-busy={signingOut}
          onClick={() => {
            if (signingOut) return;
            logout();
          }}
          className={cn("employee-dash-nav-link", dashboardSidebarSignOutButton)}
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
