import { useMemo, useSyncExternalStore } from "react";
import { Link } from "react-router";
import { Loader2, Rocket, X } from "lucide-react";
import { CareIcon } from "@/components/icons";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../hooks/useAuth";
import {
  isAuthLogoutTransitionActive,
  subscribeAuthLogoutTransition,
} from "../../lib/authLogoutTransition";
import { cn } from "@/lib/utils";
import { DASHBOARD_SIDEBAR_NAV_CLASS } from "../CareTipLogo";
import { BusinessLogoMark } from "./BusinessLogoMark";
import { BusinessSidebarNavShell } from "./sidebar/BusinessSidebarNavShell";
import { BusinessSidebarUpgradeCta } from "./sidebar/BusinessSidebarUpgradeCta";
import { useBusinessGuidelines } from "@/app/contexts/BusinessGuidelinesContext";
import { useBusinessVenueBrand } from "@/app/hooks/useBusinessVenueBrand";
import { BUSINESS_TYPE_I18N } from "@/app/lib/businessVenueOptions";
import { MobileDrawer } from "../ui/MobileDrawer";
import { dashboardSidebarIconButtonIdle, dashboardSidebarSignOutButton } from "@/lib/theme/dashboardSidebarUi";

interface BusinessMobileSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export function BusinessMobileSidebar({ isOpen, onClose }: BusinessMobileSidebarProps) {
  const { t } = useTranslation();
  const { user, logout, exitImpersonation } = useAuth();
  const { openGuidelines } = useBusinessGuidelines();
  const { venueName, logo, businessType } = useBusinessVenueBrand();
  const signingOut = useSyncExternalStore(
    subscribeAuthLogoutTransition,
    isAuthLogoutTransitionActive,
    () => false,
  );

  const typeLabel = useMemo(() => {
    if (!businessType) return t("shell.drawer.businessFallbackType");
    const key = BUSINESS_TYPE_I18N[businessType];
    return key ? t(key) : businessType;
  }, [businessType, t]);

  return (
    <MobileDrawer isOpen={isOpen} onClose={onClose} ariaLabel={t("shell.header.menuButtonAria")}>
      <div className="caretip-mobile-drawer-workspace shrink-0 border-b border-sidebar-border bg-sidebar px-4 pb-3.5 pt-3">
        <div className="flex items-start justify-between gap-2">
          <Link
            to="/dashboard"
            onClick={onClose}
            className="caretip-mobile-drawer-workspace__identity flex min-w-0 flex-1 flex-col gap-2.5 rounded-lg outline-none ring-sidebar-ring transition-colors hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
          >
            <BusinessLogoMark
              key={`${logo ?? "no-logo"}-${venueName}`}
              logoPathOrUrl={logo}
              businessName={venueName}
              size="dashboard"
              className="shrink-0"
            />
            <div className="min-w-0 pr-1">
              <p className="truncate text-[0.9375rem] font-semibold leading-snug text-sidebar-foreground">
                {venueName}
              </p>
              <p className="mt-0.5 truncate text-xs font-medium text-sidebar-foreground/65">
                {typeLabel}
              </p>
            </div>
          </Link>
          <button
            type="button"
            onClick={onClose}
            className={cn(
              "touch-manipulation inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl p-2.5",
              dashboardSidebarIconButtonIdle,
            )}
          >
            <X className="h-5 w-5 text-sidebar-foreground" />
          </button>
        </div>
      </div>

      <nav
        className={cn(
          DASHBOARD_SIDEBAR_NAV_CLASS,
          "min-h-0 flex-1 overflow-y-auto overscroll-contain px-0",
        )}
      >
        <BusinessSidebarNavShell onNavigate={onClose} showSubscriptionStatus={false} />
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
