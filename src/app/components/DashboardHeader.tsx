import { Link } from "react-router";
import { Menu } from "lucide-react";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../hooks/useAuth";
import { CareTipLogo } from "./CareTipLogo";
import { BusinessLogoMark } from "./business/BusinessLogoMark";
import { ProfileAvatar } from "./ui/profile-avatar";
import { useBusinessVenueBrand } from "../hooks/useBusinessVenueBrand";
import { NotificationBell } from "@/app/components/notifications/NotificationBell";
import { ThemeQuickToggle } from "@/app/components/theme/ThemeQuickToggle";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import {
  DashboardHeaderSearchDesktop,
  DashboardHeaderSearchMobileToggle,
  DashboardHeaderSearchPanel,
  DashboardHeaderSearchProvider,
} from "./dashboard/DashboardHeaderSearch";
import {
  BusinessDashboardSearch,
  BusinessDashboardSearchMobileToggle,
  BusinessDashboardSearchPanel,
  BusinessDashboardSearchProvider,
} from "./business/BusinessDashboardSearch";
import { DashboardHeaderMobileProfile } from "./dashboard/DashboardHeaderMobileProfile";
import { cn } from "@/lib/utils";

interface DashboardHeaderProps {
  onMenuClick?: () => void;
}

const headerIconBtn =
  "caretip-dashboard-header-icon-btn inline-flex shrink-0 touch-manipulation items-center justify-center rounded-lg transition-colors hover:bg-muted active:bg-muted/80";

/** Desktop-only polish for theme/language pills (never shown below lg). */
const headerControlBtn =
  "max-lg:min-h-9 max-lg:min-w-9 max-lg:rounded-lg max-lg:px-2 max-lg:py-1.5 max-lg:text-xs";

function DashboardHeaderBar({
  onMenuClick,
  isPlatformAdmin,
  isBusinessManager,
  showShellControls,
  displayName,
  displayEmail,
  settingsHref,
  user,
  venueName,
  businessLogo,
}: {
  onMenuClick?: () => void;
  isPlatformAdmin: boolean;
  isBusinessManager: boolean;
  showShellControls: boolean;
  displayName: string;
  displayEmail: string;
  settingsHref: string;
  user: ReturnType<typeof useAuth>["user"];
  venueName: string;
  businessLogo: string | null;
}) {
  const { t } = useTranslation();

  return (
    <>
      <div
        className={cn(
          "caretip-dashboard-header-row flex min-w-0 max-w-full items-center justify-between gap-2 px-3 py-2 sm:gap-2.5 sm:px-4",
          "lg:gap-3 lg:px-8 lg:py-3.5",
        )}
      >
        <div className="caretip-dashboard-header-leading flex min-w-0 flex-1 items-center gap-2 lg:gap-3">
          <button
            type="button"
            onClick={onMenuClick}
            className={cn(headerIconBtn, "min-h-9 min-w-9 shrink-0 p-2 lg:hidden")}
            aria-label={t("shell.header.menuButtonAria")}
          >
            <Menu className="h-[1.125rem] w-[1.125rem] text-foreground" />
          </button>

          {/*
            Mobile CareTip branding — sits with the leading cluster (not centered over actions).
            Wordmark when space allows; mark-only under 360px. Non-interactive.
          */}
          <div
            className="caretip-dashboard-header-brand pointer-events-none flex min-w-0 shrink items-center lg:hidden"
            role="img"
            aria-label="CareTip"
          >
            <CareTipLogo
              className="caretip-dashboard-header-brand__wordmark"
              size="headerMobile"
              variant="wordmark"
              tone="auto"
              alt=""
            />
            <CareTipLogo
              className="caretip-dashboard-header-brand__mark"
              size="iconHeader"
              variant="icon"
              alt=""
            />
          </div>

          {!isBusinessManager ? (
            <div className="hidden min-w-0 flex-1 lg:block">
              <DashboardHeaderSearchDesktop />
            </div>
          ) : (
            <div className="hidden min-w-0 flex-1 lg:block">
              <BusinessDashboardSearch variant="desktop" />
            </div>
          )}
        </div>

        <div className="caretip-dashboard-header-trailing flex shrink-0 items-center justify-end gap-1 sm:gap-1.5 lg:gap-3">
          {!isBusinessManager ? (
            <DashboardHeaderSearchMobileToggle />
          ) : (
            <BusinessDashboardSearchMobileToggle />
          )}
          {showShellControls ? (
            <NotificationBell
              className={cn(
                headerIconBtn,
                "relative min-h-9 min-w-9 p-1.5 lg:min-h-11 lg:min-w-11 lg:rounded-lg lg:p-2",
              )}
            />
          ) : null}
          {showShellControls ? (
            <div className="hidden lg:contents">
              <ThemeQuickToggle className={headerControlBtn} />
              <LanguageSwitcher variant="dashboard" className={headerControlBtn} />
            </div>
          ) : null}

          {isBusinessManager ? (
            <Link
              to="/dashboard/settings?section=business"
              className={cn(headerIconBtn, "max-w-[2.75rem] p-0.5 sm:max-w-none lg:max-w-none")}
              aria-label={t("shell.nav.settings")}
            >
              <BusinessLogoMark
                key={`${businessLogo ?? "no-logo"}-${venueName}`}
                logoPathOrUrl={businessLogo}
                businessName={venueName}
                size="dashboardHeader"
                fallbackTone="muted"
              />
            </Link>
          ) : (
            <>
              <DashboardHeaderMobileProfile
                displayName={displayName}
                displayEmail={displayEmail}
                avatarSrc={user?.avatar}
                settingsHref={settingsHref}
              />
              <div className="hidden items-center gap-3 border-l border-border pl-3 lg:flex">
                <div className="text-right">
                  <p className="text-sm font-medium text-foreground">{displayName}</p>
                  <p className="max-w-[180px] truncate text-xs text-muted-foreground">{displayEmail}</p>
                </div>
                <ProfileAvatar
                  key={user?.avatar ?? user?.id ?? "header-avatar"}
                  src={user?.avatar}
                  displayName={displayName}
                  className="h-9 w-9 ring-2 ring-accent/30 transition-all hover:ring-accent/50"
                  lightbox={false}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {!isBusinessManager ? (
        <DashboardHeaderSearchPanel />
      ) : (
        <BusinessDashboardSearchPanel />
      )}
    </>
  );
}

export const DashboardHeader = memo(function DashboardHeader({ onMenuClick }: DashboardHeaderProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isPlatformAdmin = user?.role === "platform_admin";
  const isBusinessManager = user?.role === "business";
  const { venueName, logo: businessLogo } = useBusinessVenueBrand();
  const displayName = user?.name?.trim() || t("shell.header.adminFallback");
  const displayEmail = user?.email?.trim() || t("shell.header.platformAdminEmail");

  const settingsHref =
    user?.role === "employee"
      ? "/employee/settings"
      : isPlatformAdmin
        ? "/platform-admin/system/settings"
        : "/dashboard/settings";

  const showShellControls =
    user?.role === "employee" || user?.role === "business" || user?.role === "platform_admin";

  const barProps = {
    onMenuClick,
    isPlatformAdmin,
    isBusinessManager,
    showShellControls,
    displayName,
    displayEmail,
    settingsHref,
    user,
    venueName,
    businessLogo,
  };

  return (
    <header className="caretip-dashboard-header-bar sticky top-0 z-30 border-b border-border/80 bg-background/95 backdrop-blur-[4px]">
      {isBusinessManager ? (
        <BusinessDashboardSearchProvider>
          <DashboardHeaderBar {...barProps} />
        </BusinessDashboardSearchProvider>
      ) : (
        <DashboardHeaderSearchProvider isPlatformAdmin={isPlatformAdmin}>
          <DashboardHeaderBar {...barProps} />
        </DashboardHeaderSearchProvider>
      )}
    </header>
  );
});
